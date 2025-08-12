
/*! top_videos.lowquota.v1.js
 * - No search.list calls (saves quota)
 * - Works with channel IDs (UC...)
 * - LocalStorage cache (default 12h)
 * - Sections: Most Video (top views), New Videos (latest), Featured Playlists (grid)
 */
(function(){
  "use strict";

  const API_KEY = "AIzaSyDUSHIzw4Y1X8Hh8WJ-22V_fFjI9h1hGr4";
  // Allow override via window.CHANNEL_IDS = ["UC....", ...]
  const CHANNEL_IDS = (Array.isArray(window.CHANNEL_IDS) && window.CHANNEL_IDS.length)
    ? window.CHANNEL_IDS
    : ["UCS1mpkERrKjZLhSZovPv9Dg"];

  const MAX_ITEMS = 20;             // how many items to inspect per channel
  const TOP_PICK_PER_CHANNEL = 8;   // cards per channel per row
  const MAX_TOTAL = 24;             // max cards shown in a row (combined)
  const SPEED_PX_PER_SEC = 60;      // marquee speed
  const MAX_PLAYLISTS_PER_CHANNEL = 3;
  const MAX_PLAYLISTS_TOTAL = 12;
  const CACHE_TTL_MS = (window.YT_CACHE_TTL_HOURS ? Number(window.YT_CACHE_TTL_HOURS) : 12) * 3600 * 1000;

  let paused = false;

  function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
  function qs(sel, root=document){ return root.querySelector(sel); }
  function warn(){ try { console.warn("[lowquota.v1]", ...arguments); } catch{} }
  function now(){ return Date.now(); }

  /* ------------------ tiny localStorage cache ------------------ */
  const STORE_KEY = "yt_cache_lowquota_v1";
  function lsGet(){ try{ return JSON.parse(localStorage.getItem(STORE_KEY)||"{}"); }catch{return{};} }
  function lsSet(obj){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(obj)); }catch{} }
  function cacheGet(bucket, key){
    const store = lsGet();
    const rec = store[bucket]?.[key];
    if (!rec) return null;
    if ((now() - (rec.ts||0)) > CACHE_TTL_MS) return null;
    return rec.data || null;
  }
  function cacheSet(bucket, key, data){
    const store = lsGet(); store[bucket] = store[bucket] || {};
    store[bucket][key] = { ts: now(), data }; lsSet(store);
  }

  /* ------------------ modal ------------------ */
  function createModalOnce(){
    if (document.getElementById("topVideosModal")) return;
    const modal = document.createElement("div");
    modal.id="topVideosModal";
    Object.assign(modal.style, {
      position:"fixed", inset:"0", background:"rgba(0,0,0,.6)", display:"none",
      alignItems:"center", justifyContent:"center", zIndex:"999999", padding:"2rem"
    });
    const inner = document.createElement("div");
    Object.assign(inner.style, { position:"relative", width:"50vw", maxWidth:"960px" });
    const placeholder = document.createElement("div");
    Object.assign(placeholder.style, { width:"100%", aspectRatio:"16/9" });
    const iframe = document.createElement("iframe");
    iframe.id="topVideosPlayer";
    iframe.setAttribute("allow","accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
    iframe.allowFullscreen = true;
    Object.assign(iframe.style, { position:"absolute", inset:"0", width:"100%", height:"100%", border:"0", borderRadius:"16px", background:"#000" });
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    Object.assign(closeBtn.style, {
      position:"absolute", top:"-42px", right:"0", border:"0", background:"transparent",
      color:"#fff", fontSize:"2rem", lineHeight:"1", cursor:"pointer"
    });
    closeBtn.addEventListener("click", ()=>{ iframe.src=""; modal.style.display="none"; });
    modal.addEventListener("click", (e)=>{ if (e.target === modal) { iframe.src=""; modal.style.display="none"; } });

    inner.appendChild(closeBtn); inner.appendChild(placeholder); inner.appendChild(iframe);
    modal.appendChild(inner);
    document.body.appendChild(modal);

    function resizeModal(){ inner.style.width = (window.innerWidth < 992) ? "88vw" : "50vw"; }
    window.addEventListener("resize", resizeModal); resizeModal();
  }
  function openVideoModal(videoId){
    try { const m = qs("#topVideosModal"), p = qs("#topVideosPlayer"); if (!m||!p) return;
      p.src = "https://www.youtube-nocookie.com/embed/" + videoId + "?autoplay=1&rel=0&modestbranding=1";
      m.style.display = "flex";
    } catch(e){ warn("openVideoModal", e); }
  }
  function openPlaylistModal(listId){
    try { const m = qs("#topVideosModal"), p = qs("#topVideosPlayer"); if (!m||!p) return;
      p.src = "https://www.youtube-nocookie.com/embed/videoseries?list=" + listId + "&autoplay=1&rel=0&modestbranding=1";
      m.style.display = "flex";
    } catch(e){ warn("openPlaylistModal", e); }
  }

  /* ------------------ section helpers ------------------ */
  function sectionByIdOrHeading(id, headingRegex){
    const byId = id ? document.getElementById(id) : null;
    if (byId) return byId;
    try { return qsa("section").find(sec => headingRegex.test((sec.textContent||""))); }
    catch(e){ warn("sectionByIdOrHeading", e); return null; }
  }
  function createSection(id, title){
    const sec = document.createElement("section");
    sec.id = id;
    sec.className = "news08 auto-created-"+id;
    sec.setAttribute("data-js", "auto-added");
    sec.innerHTML = [
      '<div class="container-fluid">',
      '  <div class="row justify-content-center mb-5">',
      '    <div class="col-12 content-head">',
      '      <div class="mbr-section-head">',
      '        <h4 class="mbr-section-title mbr-fonts-style align-center mb-0 display-2"><strong>'+title+'</strong></h4>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="row"></div>',
      '</div>'
    ].join("\n");
    return sec;
  }
  function insertAfter(targetSection, newSection){
    if (!targetSection || !newSection) { document.body.appendChild(newSection); return; }
    targetSection.insertAdjacentElement("afterend", newSection);
  }
  function ensureSection({ id, title, afterHeadingRegex }){
    let sec = sectionByIdOrHeading(id, new RegExp("^$"));
    if (sec) return sec;
    const afterSec = qsa("section").find(sec => afterHeadingRegex.test((sec.textContent||"")));
    const created = createSection(id, title);
    insertAfter(afterSec || document.body.lastElementChild, created);
    return created;
  }

  /* ------------------ UI builders ------------------ */
  function injectCarouselInto(hostSection){
    try {
      if (!hostSection) return null;
      let heading = hostSection.querySelector("h1,h2,h3,h4,h5");
      let insertAfter = (heading && heading.parentElement) ? heading.parentElement : hostSection;

      const old = hostSection.querySelector(".top-videos-carousel"); if (old) old.remove();

      const carousel = document.createElement("div");
      Object.assign(carousel.style, {
        position:"relative", width:"100vw", maxWidth:"none",
        marginLeft:"calc(50% - 50vw)", marginRight:"calc(50% - 50vw)",
        marginTop:"36px", padding:"0 24px"
      });

      const viewport = document.createElement("div");
      Object.assign(viewport.style, { overflow:"hidden", width:"100%" });

      const track = document.createElement("div");
      Object.assign(track.style, { display:"flex", flexWrap:"nowrap", gap:"20px", alignItems:"stretch", willChange:"transform" });

      viewport.appendChild(track); carousel.appendChild(viewport);
      insertAfter.insertAdjacentElement("afterend", carousel);

      carousel.addEventListener("mouseenter", ()=> paused = true);
      carousel.addEventListener("mouseleave", ()=> paused = false);

      track.addEventListener("click", function(e){
        const channelA = e.target.closest("a.channel-link");
        if (channelA){
          e.stopPropagation();
          e.preventDefault();
          try { window.open(channelA.href, "_blank", "noopener"); } catch(_){ location.href = channelA.href; }
          return;
        }
        const card = e.target.closest(".top-video-card"); if (!card) return;
        const vid = card.getAttribute("data-video-id"); if (!vid) return;
        e.preventDefault();
        openVideoModal(vid);
      });

      return {carousel, viewport, track};
    } catch(e){ warn("injectCarouselInto failed", e); return null; }
  }

  function buildVideoCard(item){
    const videoId = item.videoId, title=item.title||"", channelTitle=item.channelTitle||"", channelId=item.channelId||"";
    const card = document.createElement("div");
    card.className="top-video-card";
    card.setAttribute("data-video-id", videoId);
    card.setAttribute("role","button");
    card.tabIndex=0;
    Object.assign(card.style, { flex:"0 0 auto", width:"clamp(260px, 22vw, 460px)", cursor:"pointer" });

    const thumb = document.createElement("div");
    Object.assign(thumb.style, { width:"100%", aspectRatio:"16/9", borderRadius:"18px", overflow:"hidden", boxShadow:"0 10px 30px rgba(0,0,0,.15)" });
    const img = document.createElement("img");
    img.src = "https://i.ytimg.com/vi/"+videoId+"/hqdefault.jpg"; img.alt = title || "Video";
    Object.assign(img.style, { width:"100%", height:"100%", objectFit:"cover", display:"block" });
    thumb.appendChild(img);

    const meta = document.createElement("div");
    meta.style.marginTop = ".5rem"; meta.style.textAlign = "left";

    const titleDiv = document.createElement("div");
    titleDiv.textContent = title;
    Object.assign(titleDiv.style, { fontSize:"1rem", fontWeight:"600", lineHeight:"1.3" });

    const subDiv = document.createElement("div");
    subDiv.style.fontSize = ".85rem"; subDiv.style.opacity = ".9";
    const a = document.createElement("a");
    a.className="channel-link";
    a.href = channelId?("https://www.youtube.com/channel/"+channelId):"https://www.youtube.com";
    a.target="_blank"; a.rel="noopener"; a.textContent = channelTitle || "";
    a.style.color = "#0a66ff"; a.style.fontWeight = "600"; a.style.textDecoration = "none";

    subDiv.appendChild(a);
    meta.appendChild(titleDiv); meta.appendChild(subDiv);
    card.appendChild(thumb); card.appendChild(meta);
    return card;
  }

  /* ------------------ Featured Playlists (smaller grid) ------------------ */
  function injectFeaturedGridInto(hostSection){
    try{
      let heading = hostSection.querySelector("h1,h2,h3,h4,h5");
      let insertAfter = (heading && heading.parentElement) ? heading.parentElement : hostSection;
      const old = hostSection.querySelector(".featured-playlists-grid"); if (old) old.remove();

      const wrapper = document.createElement("div");
      wrapper.className = "featured-playlists-grid";
      Object.assign(wrapper.style, {
        marginTop:"28px",
        width:"100%",
        padding:"0 24px"
      });

      const grid = document.createElement("div");
      grid.className = "fp-grid fp-grid-md";
      Object.assign(grid.style, {
        display:"grid",
        gridTemplateColumns:"repeat(auto-fit, minmax(min(480px, max(320px, 36vw)), 1fr))",
        gap:"36px"
      });

      wrapper.appendChild(grid);
      insertAfter.insertAdjacentElement("afterend", wrapper);

      grid.addEventListener("click", function(e){
        const channelA = e.target.closest("a.channel-link");
        if (channelA){
          e.stopPropagation(); e.preventDefault();
          try { window.open(channelA.href, "_blank", "noopener"); } catch(_){ location.href = channelA.href; }
          return;
        }
        const openBtn = e.target.closest(".fp-btn");
        if (openBtn){
          const pid = openBtn.getAttribute("data-playlist-id");
          const url = "https://www.youtube.com/playlist?list=" + pid;
          e.preventDefault();
          try { window.open(url, "_blank", "noopener"); } catch(_){ location.href = url; }
          return;
        }
        const pcard = e.target.closest(".fp-card");
        if (!pcard) return;
        const pid = pcard.getAttribute("data-playlist-id");
        if (!pid) return;
        if (e.target.closest(".fp-cover") || e.target.closest(".fp-title")){
          e.preventDefault();
          openPlaylistModal(pid);
        }
      });

      return { grid };
    } catch(e){ warn("injectFeaturedGridInto failed", e); return null; }
  }

  function buildFeaturedPlaylistCard(pl){
    const pid = pl.id, title = pl.title || "", channelTitle = pl.channelTitle || "", channelId = pl.channelId || "", itemCount = pl.itemCount || 0;
    const card = document.createElement("article");
    card.className = "fp-card fp-card-md";
    card.setAttribute("data-playlist-id", pid);

    const cover = document.createElement("div");
    cover.className = "fp-cover";
    Object.assign(cover.style, {
      width:"100%", aspectRatio:"16/9", borderRadius:"24px",
      overflow:"hidden", boxShadow:"0 14px 36px rgba(0,0,0,.16)"
    });
    const img = document.createElement("img");
    img.src = pl.thumb || ""; img.alt = title || "Playlist";
    Object.assign(img.style, { width:"100%", height:"100%", objectFit:"cover", display:"block" });
    cover.appendChild(img);

    const meta = document.createElement("div");
    Object.assign(meta.style, { marginTop:"12px", textAlign:"left" });

    const tag = document.createElement("div");
    tag.className = "fp-tag";
    tag.textContent = channelTitle || "Playlist";
    Object.assign(tag.style, { fontSize:"0.95rem", opacity:".85", marginBottom:"6px" });

    const titleDiv = document.createElement("div");
    titleDiv.className = "fp-title";
    titleDiv.textContent = title;
    Object.assign(titleDiv.style, {
      fontWeight:"800",
      lineHeight:"1.2",
      fontSize:"clamp(1.2rem, 1vw + 0.9rem, 1.8rem)",
      letterSpacing:"0.2px"
    });

    const actions = document.createElement("div");
    Object.assign(actions.style, { marginTop:"10px" });
    const btn = document.createElement("a");
    btn.className = "fp-btn";
    btn.setAttribute("data-playlist-id", pid);
    btn.href = "https://www.youtube.com/playlist?list=" + pid;
    btn.target="_blank"; btn.rel="noopener";
    btn.textContent = "View";
    Object.assign(btn.style, {
      display:"inline-flex", alignItems:"center", justifyContent:"center",
      padding:"12px 18px", borderRadius:"999px",
      background:"#0a7d7d", color:"#fff", fontWeight:"700",
      textDecoration:"none", boxShadow:"0 10px 20px rgba(0,0,0,.14)"
    });

    const count = document.createElement("div");
    count.className="fp-count";
    count.textContent = itemCount ? (itemCount + " videos") : "";
    Object.assign(count.style, { marginTop:"4px", fontSize:".9rem", opacity:.8 });

    meta.appendChild(tag);
    meta.appendChild(titleDiv);
    meta.appendChild(actions);
    actions.appendChild(btn);
    if (itemCount){ meta.appendChild(count); }

    card.appendChild(cover);
    card.appendChild(meta);
    return card;
  }

  /* ------------------ Data via low-cost endpoints ------------------ */
  async function getUploadsPlaylistId(channelId){
    const cached = cacheGet("uploadsPl", channelId);
    if (cached) return cached;
    try{
      const url = "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id="+channelId+"&key="+API_KEY;
      const res = await fetch(url); const data = await res.json();
      const id = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null;
      if (id) cacheSet("uploadsPl", channelId, id);
      return id;
    }catch(e){ warn("getUploadsPlaylistId",e); return null; }
  }
  async function fetchChannelLatest(channelId){
    const cached = cacheGet("latest", channelId);
    if (cached) return cached.slice(0, TOP_PICK_PER_CHANNEL);
    try {
      const uploads = await getUploadsPlaylistId(channelId); if (!uploads) return [];
      const url = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId="+uploads+"&maxResults="+MAX_ITEMS+"&key="+API_KEY;
      const res = await fetch(url); const data = await res.json();
      const items = (data.items||[]).slice(0, TOP_PICK_PER_CHANNEL).map(it => ({
        videoId: it.contentDetails?.videoId,
        title: it.snippet?.title,
        channelTitle: it.snippet?.channelTitle,
        channelId: it.snippet?.channelId
      })).filter(v => v.videoId);
      cacheSet("latest", channelId, items);
      return items;
    } catch(e){ warn("fetchChannelLatest",e); const fallback = cacheGet("latest", channelId); return fallback || []; }
  }
  async function fetchChannelTop(channelId){
    const cached = cacheGet("top", channelId);
    if (cached) return cached.slice(0, TOP_PICK_PER_CHANNEL);
    try {
      const uploads = await getUploadsPlaylistId(channelId); if (!uploads) return [];
      const url = "https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId="+uploads+"&maxResults=50&key="+API_KEY;
      const res = await fetch(url); const data = await res.json();
      const ids = (data.items||[]).map(it => it.contentDetails?.videoId).filter(Boolean).slice(0, MAX_ITEMS);
      if (!ids.length) return [];
      let vids=[];
      for (let i=0;i<ids.length;i+=50){
        const vUrl = "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id="+ids.slice(i,i+50).join(",")+"&key="+API_KEY;
        const r = await fetch(vUrl); const d = await r.json(); vids = vids.concat(d.items||[]);
      }
      vids.sort((a,b)=> (Number(b.statistics?.viewCount||0) - Number(a.statistics?.viewCount||0)));
      const items = vids.slice(0, TOP_PICK_PER_CHANNEL).map(v => ({
        videoId: v.id, title: v.snippet?.title, channelTitle: v.snippet?.channelTitle, channelId: v.snippet?.channelId
      }));
      cacheSet("top", channelId, items);
      return items;
    } catch(e){ warn("fetchChannelTop",e); const fallback = cacheGet("top", channelId); return fallback || []; }
  }
  async function fetchChannelPlaylists(channelId){
    const cached = cacheGet("pls", channelId);
    if (cached) return cached;
    try{
      const url = "https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&channelId="+channelId+"&maxResults=50&key="+API_KEY;
      const res = await fetch(url); const data = await res.json();
      const mapped = (data.items||[]).map(p => ({
        id: p.id, title: p.snippet?.title, channelTitle: p.snippet?.channelTitle, channelId: p.snippet?.channelId,
        itemCount: Number(p.contentDetails?.itemCount || 0), publishedAt: p.snippet?.publishedAt || "",
        thumb: (p.snippet?.thumbnails?.maxres?.url) || (p.snippet?.thumbnails?.standard?.url) ||
               (p.snippet?.thumbnails?.high?.url) || (p.snippet?.thumbnails?.medium?.url) || (p.snippet?.thumbnails?.default?.url) || ""
      }));
      mapped.sort((a,b)=> (b.itemCount - a.itemCount) || (new Date(b.publishedAt) - new Date(a.publishedAt)));
      const top = mapped.slice(0, MAX_PLAYLISTS_PER_CHANNEL);
      cacheSet("pls", channelId, top);
      return top;
    }catch(e){ warn("fetchChannelPlaylists",e); const fallback = cacheGet("pls", channelId); return fallback || []; }
  }

  /* ------------------ marquee helpers ------------------ */
  function measureGroupWidth(track, groupCount){
    const gap = 20; let total=0; groupCount = Math.min(groupCount, track.children.length);
    for (let i=0;i<groupCount;i++){ const el = track.children[i]; total += Number(el&&el.offsetWidth||0); if (i<groupCount-1) total += gap; }
    return Number(total||0);
  }
  function addClones(track, times, groupCount){
    times = Math.max(0, Math.min(times, 8));
    while (times-- > 0){ for (let i=0;i<groupCount;i++){ const src = track.children[i]; if (src) track.appendChild(src.cloneNode(true)); } }
  }
  function ensureEnoughClones(viewport, track, groupCount, groupWidth){
    const vw = Number(viewport.clientWidth||0);
    const need = vw + groupWidth + vw; const have = Number(track.scrollWidth||0);
    if (groupWidth <= 1 || vw <= 1 || have >= need) return;
    const perGroup = groupWidth, missing = need - have;
    const groupsNeeded = Math.ceil(missing / perGroup);
    addClones(track, groupsNeeded, groupCount);
  }
  function startMarquee(viewport, track, groupCount, groupWidth){
    let offset = 0, last = performance.now();
    function frame(now){ const dt=(now-last)/1000; last=now; if(!paused){ offset += SPEED_PX_PER_SEC*dt; if(groupWidth>0 && offset>=groupWidth) offset -= groupWidth; track.style.transform="translateX("+(-offset)+"px)"; } requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
    function recalc(){ const gw=measureGroupWidth(track, groupCount); ensureEnoughClones(viewport, track, groupCount, gw); groupWidth = gw>0?gw:groupWidth; if(groupWidth>0) offset%=groupWidth; }
    recalc(); window.addEventListener("resize", recalc); if (document.fonts && document.fonts.ready){ document.fonts.ready.then(recalc).catch(()=>{}); }
  }

  /* ------------------ set up each row ------------------ */
  async function setupRow({ id, headingRegex, mode, afterHeadingRegex, titleIfCreate }){
    try{
      let host = sectionByIdOrHeading(id, headingRegex);
      if (!host){ host = ensureSection({ id, title: titleIfCreate, afterHeadingRegex }); }
      const injected = injectCarouselInto(host); if (!injected) return;
      const { viewport, track } = injected;

      let all=[];
      for (const cid of CHANNEL_IDS){
        const arr = (mode==="latest") ? await fetchChannelLatest(cid) : await fetchChannelTop(cid);
        all = all.concat(arr);
      }
      if (!all.length) return;
      const items = (mode==="latest") ? all.slice(0, Math.min(MAX_TOTAL, all.length)) : (all.length>MAX_TOTAL? all.sort(()=>Math.random()-0.5).slice(0,MAX_TOTAL):all);
      track.innerHTML=""; const cards=items.map(buildVideoCard); cards.forEach(c=>track.appendChild(c));

      const imgs = Array.from(track.querySelectorAll("img")); if (imgs.length){ await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(res => { img.onload=img.onerror=()=>res(); }))); }
      const groupWidth = measureGroupWidth(track, cards.length); ensureEnoughClones(viewport, track, cards.length, groupWidth); startMarquee(viewport, track, cards.length, groupWidth);
    }catch(e){ warn("setupRow failed", e); }
  }

  /* ------------------ init ------------------ */
  async function init(){
    try{
      createModalOnce();

      // 1) Build rows first (Latest + New)
      await setupRow({
        id: "", headingRegex: /most video/i, mode: "top",
        afterHeadingRegex: /most video/i, titleIfCreate: "Most Video"
      });
      await setupRow({
        id: "new-videos-section", headingRegex: /new videos/i, mode: "latest",
        afterHeadingRegex: /most video/i, titleIfCreate: "New Videos"
      });

      // 2) Featured Playlists under New Videos
      let host = sectionByIdOrHeading("featured-playlists-section", /(featured playlists|playlists nổi bật)/i);
      if (!host){
        host = ensureSection({ id: "featured-playlists-section", title: "Featured Playlists", afterHeadingRegex: /new videos/i });
      }
      const injected = injectFeaturedGridInto(host);
      if (!injected) return;
      const { grid } = injected;

      let all=[];
      for (const cid of CHANNEL_IDS){
        const pls = await fetchChannelPlaylists(cid);
        all = all.concat(pls);
      }
      if (!all.length) return;
      all = all.slice(0, Math.min(MAX_PLAYLISTS_TOTAL, all.length));
      grid.innerHTML = "";
      all.forEach(pl => grid.appendChild(buildFeaturedPlaylistCard(pl)));
    } catch(e){ warn("init failed", e); }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
