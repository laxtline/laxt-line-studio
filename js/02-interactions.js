/* =====================================================================
   LAXTLINE — js/02-interactions.js
   ---------------------------------------------------------------------
   The site's core interactivity. Contains, in order:
     • Hero canvas animation  — floating particles + drifting grid lines,
       auto-paused when the hero is off-screen or the tab is hidden (perf)
     • Custom cursor          — dot follows instantly, ring eases behind;
       the rAF loop stops while the mouse is idle to save CPU
     • Scroll reveal          — IntersectionObserver adds .visible to
       elements as they enter the viewport (with a safety fallback)
     • Nav scroll state       — subtle red border once you scroll down
     • Hamburger / mobile menu — open & close handlers

   All listeners are passive / rAF-throttled to keep scrolling smooth.
   ===================================================================== */

// ===== SCROLL REVEAL =====
// Runs FIRST, on purpose. `.reveal` elements start at opacity:0, so if any
// feature below ever throws, the page must not be left blank. Keeping this
// at the top means content visibility never depends on the canvas, the
// cursor or the menu initialising successfully.
(function initScrollReveal(){
  const reveals = document.querySelectorAll('.reveal,.reveal-left');
  const showAll = ()=>document.querySelectorAll('.reveal:not(.visible),.reveal-left:not(.visible)')
    .forEach(el=>el.classList.add('visible'));

  if(!('IntersectionObserver' in window)){ showAll(); return; }

  const observer = new IntersectionObserver(entries=>{
    entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}});
  },{threshold:.08,rootMargin:'0px 0px -40px 0px'});
  reveals.forEach(r=>observer.observe(r));

  // Safety fallback: after 2s force-show any .reveal still invisible
  // (guards against content-visibility or offscreen observer misses)
  setTimeout(showAll, 2000);
})();

// ===== HERO CANVAS ANIMATION — OPTIMISED =====
// Guard: if #heroBg is ever absent, getContext would throw and take down the
// cursor, scroll-reveal and nav handlers below with it. Bail out of just the
// canvas feature instead.
const canvas = document.getElementById('heroBg');
const ctx = canvas ? canvas.getContext('2d') : null;
let W, H, particles = [], lines = [];
// PERF: use offscreen canvas for grid (draw once, blit every frame)
let gridCanvas = null, gridCtx = null;

function buildGridCache(){
  gridCanvas = document.createElement('canvas');
  gridCanvas.width = W; gridCanvas.height = H;
  gridCtx = gridCanvas.getContext('2d');
  gridCtx.strokeStyle='rgba(232,57,42,0.04)';
  gridCtx.lineWidth=0.5;
  // PERF: batch all grid lines into one path instead of stroke() per line
  gridCtx.beginPath();
  for(let x=0;x<=W;x+=80){gridCtx.moveTo(x,0);gridCtx.lineTo(x,H);}
  for(let y=0;y<=H;y+=80){gridCtx.moveTo(0,y);gridCtx.lineTo(W,y);}
  gridCtx.stroke();
}

function resizeCanvas(){
  if(!canvas) return;
  W = canvas.width = canvas.offsetWidth;
  H = canvas.height = canvas.offsetHeight;
  buildGridCache();
}
resizeCanvas();
let _resizeTimer;
window.addEventListener('resize', ()=>{clearTimeout(_resizeTimer);_resizeTimer=setTimeout(resizeCanvas,200);},{passive:true});

// PERF: detect mobile — reduce particle count on low-end devices
const isMobile = window.matchMedia('(hover:none)').matches;
const PARTICLE_COUNT = isMobile ? 25 : 45; // was 60
const CONN_DIST_SQ = 100*100;

// A single drifting dot in the hero background. ~30% are brand-red, the rest
// are faint white; each moves slowly and respawns when it leaves the canvas.
class Particle {
  constructor(){this.reset()}
  // Randomise position, size, drift speed and colour (called on spawn + respawn)
  reset(){
    this.x = Math.random()*W;
    this.y = Math.random()*H;
    this.size = Math.random()*1.5+0.3;
    this.speedX = (Math.random()-.5)*0.4;
    this.speedY = (Math.random()-.5)*0.4;
    this.opacity = Math.random()*0.5+0.1;
    this.color = Math.random()>.7 ? 'rgba(232,57,42,'+this.opacity+')' : 'rgba(255,255,255,'+(this.opacity*0.4)+')';
  }
  // Advance one frame; recycle the particle once it drifts off-screen
  update(){
    this.x+=this.speedX; this.y+=this.speedY;
    if(this.x<0||this.x>W||this.y<0||this.y>H) this.reset();
  }
  // Paint the particle as a filled circle
  draw(){
    ctx.beginPath();
    ctx.arc(this.x,this.y,this.size,0,Math.PI*2);
    ctx.fillStyle=this.color;
    ctx.fill();
  }
}

// A faint horizontal or vertical line that slowly slides across the hero,
// layered over the static cached grid to add subtle motion.
class GridLine {
  constructor(isHorizontal){this.isH=isHorizontal;this.reset();}
  // Pick a random starting offset, direction and very low opacity
  reset(){
    this.pos = this.isH ? Math.random()*H : Math.random()*W;
    this.speed = (Math.random()*0.3+0.1)*(Math.random()>.5?1:-1);
    this.opacity = Math.random()*0.06+0.02;
    this.color = Math.random()>.6 ? 'rgba(232,57,42,'+this.opacity+')' : 'rgba(255,255,255,'+this.opacity+')';
  }
  // Slide along its axis; respawn once it exits the canvas
  update(){
    this.pos += this.speed;
    if(this.isH && (this.pos<0||this.pos>H)) this.reset();
    if(!this.isH && (this.pos<0||this.pos>W)) this.reset();
  }
  // Stroke the line across the full width (horizontal) or height (vertical)
  draw(){
    ctx.beginPath();ctx.strokeStyle=this.color;ctx.lineWidth=0.5;
    if(this.isH){ctx.moveTo(0,this.pos);ctx.lineTo(W,this.pos);}
    else{ctx.moveTo(this.pos,0);ctx.lineTo(this.pos,H);}
    ctx.stroke();
  }
}

for(let i=0;i<PARTICLE_COUNT;i++) particles.push(new Particle());
for(let i=0;i<6;i++) lines.push(new GridLine(i%2===0)); // 6 lines (was 8)

// PERF: pause canvas when hero out of view OR tab hidden.
// Track the two signals SEPARATELY and pause if either says so — otherwise
// returning to the tab (visibilitychange → hidden=false) would resume the
// loop even while the hero is still scrolled off-screen, since the observer
// doesn't re-fire without an intersection change.
let canvasPaused = false;
let heroOnScreen = true, tabVisible = true;
function updateCanvasPaused(){ canvasPaused = !heroOnScreen || !tabVisible; }
const canvasSection = canvas ? (canvas.closest('section') || canvas.parentElement) : null;
if(canvasSection && 'IntersectionObserver' in window){
  const canvasObs = new IntersectionObserver(entries=>{
    heroOnScreen = entries[0].isIntersecting;
    updateCanvasPaused();
  },{threshold:0});
  canvasObs.observe(canvasSection);
}
// Also pause when tab hidden
document.addEventListener('visibilitychange',()=>{ tabVisible = !document.hidden; updateCanvasPaused(); },{passive:true});

function animateCanvas(){
  if(!ctx) return;
  if(!canvasPaused){
    ctx.clearRect(0,0,W,H);
    // PERF: blit pre-rendered grid from offscreen canvas (zero recalc)
    if(gridCanvas) ctx.drawImage(gridCanvas,0,0);
    lines.forEach(l=>{l.update();l.draw();});
    // PERF: skip particle connections on mobile (saves O(n²) per frame)
    if(!isMobile){
      for(let i=0;i<particles.length;i++){
        for(let j=i+1;j<particles.length;j++){
          const dx=particles[i].x-particles[j].x, dy=particles[i].y-particles[j].y;
          const distSq=dx*dx+dy*dy;
          if(distSq<CONN_DIST_SQ){
            const alpha = 0.04*(1-Math.sqrt(distSq)/100);
            ctx.beginPath();
            ctx.strokeStyle='rgba(232,57,42,'+alpha+')';
            ctx.lineWidth=0.5;
            ctx.moveTo(particles[i].x,particles[i].y);
            ctx.lineTo(particles[j].x,particles[j].y);
            ctx.stroke();
          }
        }
        particles[i].update();
        particles[i].draw();
      }
    } else {
      particles.forEach(p=>{p.update();p.draw();});
    }
  }
  requestAnimationFrame(animateCanvas);
}
animateCanvas();

// CURSOR — GPU-accelerated, idle-stops rAF when mouse not moving
const cursor = document.getElementById('cursor');
const follower = document.getElementById('cursorFollower');

// Detect touch/mobile — remove cursor elements entirely on touch devices.
// NOTE: js/01-cursor-init.js only writes these elements on non-touch devices,
// so on a phone both lookups return null — always optional-chain them.
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const hasCursor = !!(cursor && follower);
if(isTouchDevice || !hasCursor){
  cursor?.remove();
  follower?.remove();
} else {
  // mx,my = live mouse position; fx,fy = the follower ring's eased position
  let mx=0,my=0,fx=0,fy=0;
  let cursorRafScheduled=false, followerRafId=null, cursorIdle=false, idleTimer=null;
  // Snap the dot straight to the cursor (one rAF per move, coalesced)
  function updateCursor(){
    cursor.style.transform='translate('+mx+'px,'+my+'px) translate(-50%,-50%)';
    cursorRafScheduled=false;
  }
  // Ease the ring toward the cursor; stop the loop once it has caught up (idle)
  function animFollow(){
    const dx=mx-fx, dy=my-fy;
    if(Math.abs(dx)<0.1 && Math.abs(dy)<0.1){cursorIdle=true;followerRafId=null;return;}
    fx+=dx*.12; fy+=dy*.12;
    follower.style.transform='translate('+fx+'px,'+fy+'px) translate(-50%,-50%)';
    followerRafId=requestAnimationFrame(animFollow);
  }
  document.addEventListener('mousemove',e=>{
    mx=e.clientX; my=e.clientY;
    if(!cursorRafScheduled){cursorRafScheduled=true;requestAnimationFrame(updateCursor);}
    if(cursorIdle){cursorIdle=false;followerRafId=requestAnimationFrame(animFollow);}
    clearTimeout(idleTimer);
    idleTimer=setTimeout(()=>{cursorIdle=true;},2000);
  },{passive:true});
  followerRafId=requestAnimationFrame(animFollow);
}

// Cursor expand on hover — only on non-touch devices
if(!isTouchDevice && hasCursor){
  document.body.addEventListener('mouseover',e=>{
    const el=e.target.closest('a,button,.proj,.gal-item,.social-btn,.whatsapp-btn');
    if(el){cursor.classList.add('hover');follower.classList.add('hover');}
  },{passive:true});
  document.body.addEventListener('mouseout',e=>{
    const el=e.target.closest('a,button,.proj,.gal-item,.social-btn,.whatsapp-btn');
    if(el){cursor.classList.remove('hover');follower.classList.remove('hover');}
  },{passive:true});
}

// SCROLL REVEAL — see initScrollReveal() at the top of this file.

// NAV scroll subtle border — throttled with RAF to prevent layout thrashing
let scrollTicking = false;
const nav = document.querySelector('nav');
if(nav){
  window.addEventListener('scroll',()=>{
    if(!scrollTicking){
      requestAnimationFrame(()=>{
        if(window.scrollY>80){nav.style.borderBottomColor='rgba(232,57,42,0.15)'}
        else{nav.style.borderBottomColor='rgba(255,255,255,0.06)'}
        scrollTicking=false;
      });
      scrollTicking=true;
    }
  },{passive:true});
}



// Stagger reveal delays
// Give each card an increasing transition-delay so they fade in one-by-one
// (a cascade) instead of all at once when the section scrolls into view.
document.querySelectorAll('.service-item').forEach((c,i)=>c.style.transitionDelay=(i*0.1)+'s');

// HAMBURGER MENU
const hamburger = document.getElementById('hamburger');
const mobileNav = document.getElementById('mobileNav');
// Close the mobile menu and restore page scrolling (called by nav-link onclick too)
function closeMobileNav(){
  hamburger?.classList.remove('open');
  mobileNav?.classList.remove('open');
  document.body.style.overflow='';
}
if(hamburger && mobileNav){
  hamburger.addEventListener('click',()=>{
    hamburger.classList.toggle('open');
    mobileNav.classList.toggle('open');
    document.body.style.overflow = mobileNav.classList.contains('open') ? 'hidden' : '';
  });
  // Close mobile nav on outside click
  mobileNav.addEventListener('click',(e)=>{
    if(e.target===mobileNav) closeMobileNav();
  });
}
