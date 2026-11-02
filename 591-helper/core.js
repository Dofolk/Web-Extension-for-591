(() => {
  const kinds = {1:'整層住家',2:'獨立套房',3:'分租套房',4:'雅房'};
  function idOf(url) {
    try {const u=new URL(url,'https://rent.591.com.tw'); return u.origin==='https://rent.591.com.tw' && !u.username && !u.password ? (u.pathname.match(/^\/(?:home\/)?(\d+)\/?$/)?.[1] || u.pathname.match(/^\/rent-detail-(\d+)\.html$/)?.[1] || null) : null;} catch {return null;}
  }
  function searchURL(base,kind,page=1) {
    const u=new URL(base); if(u.origin!=='https://rent.591.com.tw'||u.username||u.password)throw new Error('不允許的搜尋網址'); if(!Object.hasOwn(kinds,String(kind)))throw new Error('不允許的房型'); u.pathname='/list'; u.hash='';
    u.searchParams.set('kind',kind); u.searchParams.set('page',page);
    u.searchParams.delete('firstRow'); return u.href;
  }
  // Rebuild display markup only. The source page's handlers and custom elements
  // must never become active when a fetched card is mounted on the live page.
  function nativeCard(source, doc, id) {
    const tags = new Set(['div','span','ul','li','strong','i','a','img','p','small','b','em','s','del','br']);
    const url = 'https://rent.591.com.tw/' + id;
    function copy(node) {
      if (node.nodeType === 3) return doc.createTextNode(node.textContent);
      if (!tags.has(node.localName) || node.matches('.toggle-btn,.indicators,.rh-select,.rh-badge')) return null;
      const el = doc.createElement(node.localName);
      for (const attr of node.attributes) {
        if (attr.name === 'class' || /^data-v-[a-z0-9]+$/.test(attr.name)) el.setAttribute(attr.name,attr.value);
      }
      if (el.localName === 'a') {
        el.href = url;
        el.target = '_blank';
        el.rel = 'noopener';
      }
      if (el.localName === 'img') {
        let photo;
        try { photo = new URL(node.getAttribute('src') || node.getAttribute('data-src'),url); } catch { return null; }
        if (photo.protocol !== 'https:' || !/^img[0-9]*\.591\.com\.tw$/.test(photo.hostname) || photo.username || photo.password || photo.port) return null;
        el.src = photo.href;
        el.alt = node.getAttribute('alt') || '';
        el.setAttribute('loading','lazy');
        el.setAttribute('referrerpolicy','no-referrer');
      }
      for (const child of node.childNodes) {
        const clean = copy(child);
        if (clean) el.append(clean);
      }
      return el;
    }
    const card = copy(source);
    card.dataset.id = id;
    const photo = card.querySelector('.item-img');
    if (photo && !photo.querySelector('a')) {
      const link = doc.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.setAttribute('aria-label','查看房源照片與詳情');
      link.className = 'rh-photo-link';
      photo.append(link);
    }
    return card;
  }
  function readCard(card,selected) {
    const a=card.querySelector('.item-info-title a'); const id=a && idOf(a.href || a.getAttribute('href'));
    if(!id) return null;
    const info=[...card.querySelectorAll('.item-info-txt')].map(x=>x.textContent.trim().replace(/\s+/g,' '));
    const kind = selected.find(key=>info[0]?.includes(kinds[key]));
    if(!kind) return null;
    const update = [...card.querySelectorAll('.role-name span')].map(x=>x.textContent.trim()).find(x=>x.includes('更新')) || '';
    const age = update.match(/(\d+)\s*(分鐘|小時|天|秒)/);
    const seconds = age ? Number(age[1]) * ({秒:1,分鐘:60,小時:3600,天:86400}[age[2]]) : /昨日|昨天/.test(update) ? 86400 : /剛剛|剛更新/.test(update) ? 0 : Infinity;
    const priceText = card.querySelector('.item-info-price strong')?.textContent.replace(/,/g,'').trim();
    const ping = info[0]?.match(/([\d.]+)坪/);
    return {card:nativeCard(card,card.ownerDocument,id),id,seconds,rent:priceText && Number.isFinite(Number(priceText)) ? Number(priceText) : null,ping:ping ? Number(ping[1]) : null,title:a.textContent.trim(),url:'https://rent.591.com.tw/'+id,info:info.join(' · '),price:card.querySelector('.item-info-price')?.textContent.trim() || '租金未提供',kind};
  }
  function parse(doc,url,kind) {
    const items=new Map();
    for(const card of doc.querySelectorAll('.item[data-id]')) {
      const item=readCard(card,[kind]);
      if(item) items.set(item.id,item);
    }
    const next=[...doc.querySelectorAll('a[href]')].find(a=>a.textContent.trim()==='下一頁');
    let nextURL=null;try{nextURL=next ? new URL(next.getAttribute('href'),url) : null;}catch{}
    if(nextURL && (nextURL.origin!=='https://rent.591.com.tw' || nextURL.username || nextURL.password || !Number.isSafeInteger(Number(nextURL.searchParams.get('page'))) || nextURL.pathname!=='/list' || nextURL.searchParams.get('kind')!==String(kind) || Number(nextURL.searchParams.get('page'))<=Number(new URL(url).searchParams.get('page')||1))) nextURL=null;
    if(!items.size) throw new Error('未辨識到此房型的房源，可能無結果、頁面改版或需要驗證；請開啟原搜尋頁確認。');
    return {items:[...items.values()],next:nextURL ? searchURL(url,kind,Number(nextURL.searchParams.get('page'))) : null};
  }
  function expiredSeen(key,time,now=Date.now()){
    return /^rhSeen:\d{1,20}$/.test(key) && Number.isSafeInteger(time) && time>0 && now-time>90*86400000;
  }
  globalThis.RentHelper={expiredSeen,kinds,idOf,searchURL,parse,readCard};
})();
