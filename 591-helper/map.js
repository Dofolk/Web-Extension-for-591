(() => {
  const kinds = RentHelper.kinds;
  const floors = {'0_1':'1層','2_6':'2–6層','6_12':'6–12層','12_':'12層以上'};
  const notices = {all_sex:'男女皆可',boy:'限男生',girl:'限女生',not_cover:'排除頂樓加蓋'};
  const split = value => (value || '').split(',').filter(Boolean);
  function capture(url, selectedKinds, doc) {
    const params = new URL(url).searchParams;
    const active = group => [...doc.querySelectorAll('.'+group+'.options-container .filter-item.active')].map(el=>el.textContent.trim());
    const rent = params.get('price') || '';
    const max = doc.querySelector('.price.options-container input[placeholder="最高價"]')?.value ||
      rent.match(/^(?:0)?_(\d+)\$?$/)?.[1] || '';
    const floorLabels = active('floor');
    return {kinds:selectedKinds.filter(id=>Object.hasOwn(kinds,id)),
      max:String(max), floors:Object.keys(floors).filter(key=>floorLabels.includes(floors[key].replace('–','-')) ||
        split(params.get('floor')).some(code=>key==='12_' ? code.startsWith('12_') : code===key)),
      notices:Object.keys(notices).filter(key=>active('notice').includes(notices[key]) || split(params.get('notice')).includes(key))};
  }
  // Point detail uses broad labels even when the overview gives the exact subtype.
  const typeKeys = new Map(Object.entries(kinds).map(([key,name]) => [name,[key]]));
  typeKeys.set('套房',['2','3']);
  typeKeys.set('整層',['1']);
  for (const name of ['店面','辦公','住辦','廠房','車位','土地','其他']) typeKeys.set(name,[]);
  function factMismatch(config, type, rent, floorText) {
    const possible = typeKeys.get(type?.trim());
    if (possible && config.kinds.length && !possible.some(key=>config.kinds.includes(key))) return true;
    if (rent && config.max && rent>Number(config.max)) return true;
    if (config.notices.includes('not_cover') && /頂樓加蓋|頂加/.test(floorText)) return true;
    const floor = floorText.match(/(?:^|\s)(-?\d+)F?\s*\/\s*\d+F/i);
    if (floor && config.floors.length) {
      const n = Number(floor[1]);
      return !config.floors.some(range=>range==='0_1'?n===1:range==='2_6'?n>=2&&n<=6:range==='6_12'?n>=6&&n<=12:n>=12);
    }
    return false;
  }
  // A point reply can identify the map pin in hid_collectids but use the community ID on its cards.
  function belongsToPoint(point, cardGroup, replyPoint) {
    if (!cardGroup || cardGroup === '0') return false;
    if (cardGroup === point.id || cardGroup === point.collect) return true;
    return cardGroup === point.cases && replyPoint === point.id;
  }
  function setup(root, store, repaint) {
    const section = root.querySelector('#searchArea');
    section.innerHTML = '<h3>地圖進階篩選</h3><div id="mapFields"></div><label>最高月租（元） <input id="mapPrice" type="number" min="1" max="99999999" placeholder="不限" style="width:110px"></label><p><button id="mapApply">套用</button> <button id="mapImport">沿用列表篩選</button> <button id="mapOff">關閉進階篩選</button></p><p id="mapStatus" role="status"></p><small id="pointStatus"></small><button id="mapMore" hidden>繼續比對下一批</button><p class="muted">已查過的點位與區域結果在本機保留 30 分鐘，移回時直接沿用。比對中的刊登保留顯示；群組點位保留原站間數。地圖原生「類型」選不限可同時搜尋多種房型。</p>';
    const find = id=>section.querySelector('#'+id);
    const groups = {};
    for(const [key,title,options] of [['kinds','房型',kinds],['floors','樓層',floors],['notices','承租條件與排除項目',notices]]) {
      const field = document.createElement('fieldset');
      const legend = document.createElement('legend');legend.textContent=title;field.append(legend);
      groups[key]=[];
      for (const [value,text] of Object.entries(options)) {
        const input=document.createElement('input');input.type='checkbox';input.value=value;
        const label=document.createElement('label');label.append(input,document.createTextNode(text));field.append(label);groups[key].push(input);
      }
      find('mapFields').append(field);
    }
    function display(config) {
      for(const [key,inputs] of Object.entries(groups)) for(const input of inputs)input.checked=config?.[key]?.includes(input.value) || false;
      find('mapPrice').value=config?.max || '';
    }
    let active=null, run=null, scope='', next=0, complete=false, busy=false, matches=new Set(), visited=new Set(), total=0;
    // Keep records separate so concurrent map tabs can write unrelated areas safely.
    const prefix = 'rhCache1:';
    const lifetime = 30 * 60 * 1000;
    const cache = new Map(Object.entries(store).filter(([key])=>key.startsWith(prefix)));
    chrome.storage.onChanged.addListener((changes,area)=>{
      if(area!=='local')return;
      for(const [key,change] of Object.entries(changes)){
        if(!key.startsWith(prefix))continue;
        if(change.newValue)cache.set(key,change.newValue);
        else cache.delete(key);
      }
    });
    function cached(key) {
      const entry=cache.get(prefix+key);
      return entry && Date.now()-entry.time<lifetime ? entry.value : undefined;
    }
    function remember(key,value) {
      const full=prefix+key;
      const entry={time:Date.now(),value,size:JSON.stringify(value).length*2+full.length*2+128};
      if(entry.size>1000000)return;
      cache.set(full,entry);
      const expired=[];
      let used=0;
      for(const [name,item] of [...cache].sort((a,b)=>b[1].time-a[1].time)){
        if(Date.now()-item.time>=lifetime || used+item.size>3000000) {
          expired.push(name);cache.delete(name);
        } else used+=item.size;
      }
      if(expired.length)chrome.storage.local.remove(expired).catch(()=>{});
      chrome.storage.local.set({[full]:entry}).catch(()=>{});
    }
    function areaKey() {
      return 'area:'+JSON.stringify([scope,active.max,...['kinds','floors','notices'].map(k=>[...active[k]].sort())]);
    }
    function region() {
      const p=viewParams();
      return [p.get('rid'),p.get('sid')].map(v=>/^\d+$/.test(v||'')&&Number(v)>0?v:'').join('/');
    }
    function state(msg) {find('mapStatus').textContent=msg;find('mapMore').hidden=!active || !next || busy;}
    let paintTimer;
    function schedulePaint() {
      if(paintTimer)return;
      paintTimer=setTimeout(()=>{paintTimer=null;repaint();},16);
    }
    function start(config) {
      const newScope=region();
      if(config && active && newScope===scope && JSON.stringify(config)===JSON.stringify(active) && busy){
        repaint();return;
      }
      run?.abort();run=new AbortController();scope=newScope;active=config;
      matches=new Set();visited=new Set();next=config?1:0;complete=false;busy=false;
      const saved=config && cached(areaKey());
      if(saved){
        matches=new Set(saved.matches);visited=new Set(saved.visited);
        next=saved.next;total=saved.total;complete=next===0;
        state('已從本機載入 '+visited.size+' / '+total+' 筆。'+(complete?'比對完成。':'接續上次進度。'));
      }
      repaint();
      if(config) load(); else state('進階篩選已關閉。');
    }
    async function load() {
      if(!active||!next||busy)return;
      const [rid,sid]=scope.split('/');
      if(!rid){state('請先在地圖選縣市，房型、租金與樓層已先套用到可辨識的卡片。');return;}
      const signal=run.signal;busy=true;
      try {
        for(let count=0;count<4&&next;count++){
          state('已套用本機條件。正在向 591 核對第 '+next+' 頁…');
          const u=new URL('/list',location.origin);u.searchParams.set('region',rid);
          if(sid)u.searchParams.set('section',sid);
          if(active.max)u.searchParams.set('price','0_'+active.max+'$');
          if(active.notices.length)u.searchParams.set('notice',active.notices.join(','));
          u.searchParams.set('page',next);
          const response=await fetch(u.href,{mode:'same-origin',redirect:'error',credentials:'same-origin',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
          if(!response.ok)throw Error('591 回應 '+response.status);
          const html=await response.text();if(signal.aborted)return;
          if(html.length>5000000)throw Error('頁面過大');
          const template=document.createElement('template');template.innerHTML=html;
          const doc=template.content;
          const checked=[...doc.querySelectorAll('.notice .filter-item.active')].map(e=>e.textContent.trim());
          if(active.notices.some(key=>!checked.includes(notices[key])))throw Error('591 未確認所有須知條件');
          if(active.max && doc.querySelector('.price input[placeholder="最高價"]')?.getAttribute('value')!==active.max)throw Error('591 未確認租金條件');
          const number=doc.querySelector('.list-sort .total strong')?.textContent.replace(/,/g,'').trim();
          if(!/^\d+$/.test(number||''))throw Error('無法確認結果總數');
          total=Number(number);
          const cards=[...doc.querySelectorAll('.item[data-id]')];
          let added=0;
          for(const card of cards){
            const id=RentHelper.idOf(card.querySelector('.item-info-title a')?.getAttribute('href'));
            if(!id)continue;
            if(!visited.has(id)){added++;visited.add(id);}
            const info=card.querySelector('.item-info-txt');
            const type=info?.querySelector('span')?.textContent.trim();
            const price=Number(card.querySelector('.item-info-price strong')?.textContent.replace(/,/g,''));
            const floor=[...(info?.querySelectorAll('span')||[])].map(e=>e.textContent).join(' ');
            if(!factMismatch(active,type,price,floor))matches.add(id);
          }
          const link=[...doc.querySelectorAll('.navigator a')].find(a=>a.textContent.trim()==='下一頁')?.getAttribute('href');
          if(link){
            const page=Number(new URL(link,u).searchParams.get('page'));if(page!==next+1||!added)throw Error('分頁無法確認');next=page;
          }else{
            if(visited.size<total)throw Error('列表數量變動，尚未比對的物件會保留');
            next=0;complete=true;
          }
          remember(areaKey(),{matches:[...matches],visited:[...visited],next,total});
          schedulePaint();
        }
        busy=false;state('已核對 '+visited.size+' / '+total+' 筆區域房源。'+(complete?'已完成。':'正在分批比對，未核對房源暫時保留。'));repaint();
        if(next && !complete)setTimeout(()=>{if(!signal.aborted && !busy)load();},50);
      }catch(e){if(signal.aborted)return;busy=false;state(e.message+'。未核對的房源會保留，可重試。');repaint();}
    }
    function apply(followList=false){
      const config={max:find('mapPrice').value};
      if(config.max&&!/^[1-9]\d{0,7}$/.test(config.max)){state('請輸入有效的最高月租。');return;}
      for(const [key,inputs] of Object.entries(groups))config[key]=inputs.filter(x=>x.checked).map(x=>x.value);
      failedPoints.clear();
      chrome.storage.local.set({rhMapConfig:config,rhMapFollowList:followList});start(config);
    }
    find('mapApply').onclick=()=>apply(false);
    find('mapMore').onclick=load;
    find('mapImport').onclick=async()=>{
      const {rhListPreset}=await chrome.storage.local.get('rhListPreset');
      if(!rhListPreset){state('請先開啟一般列表並選好條件。');return;}
      display(rhListPreset);apply(true);
    };
    find('mapOff').onclick=()=>{chrome.storage.local.set({rhMapConfig:null,rhMapFollowList:false});start(null);};
    const initial=(store.rhMapFollowList || store.rhMapConfig===undefined) ? (store.rhListPreset || store.rhMapConfig) : store.rhMapConfig;
    display(initial||store.rhListPreset);
    queueMicrotask(()=>start(initial||null));
    const knownTypes = new Map();
    function excluded(id){return !!active&&!matches.has(id)&&(complete||visited.has(id));}
    // Read the same GET response as a marker click, without changing the map selection.
    let pointScope = null, pointRun, resumeTimer;
    const inFlight=new Set();
    let pendingPoints = new Map();
    const failedPoints = new Set();
    let pauseUntil = 0;
    function viewParams() {
      const urlParams = new URLSearchParams(location.hash.slice(1));
      const nativeParams = new URLSearchParams(document.querySelector('#req_url')?.value || '');
      const p = nativeParams.get('l11')==='1' ? nativeParams : urlParams;
      for (const key of ['p11','p12','p13','p14']) p.delete(key);
      p.sort();
      return p;
    }
    function cardFacts(card) {
      const id = RentHelper.idOf(card.querySelector('.title a')?.getAttribute('href'));
      const desc = card.querySelector('.proname .c > p:last-child')?.textContent.trim() || '';
      const rawType = desc.split('/')[0].trim();
      const price = Number(card.querySelector('.price em')?.textContent.replace(/[,元\s]/g,''));
      return {id, desc, rawType, price};
    }
    function rejected(facts) {
      const type = knownTypes.get(facts.id) || facts.rawType;
      return !!active && (excluded(facts.id) || factMismatch(active,type,facts.price,facts.desc));
    }
    async function readPoint(point,signal) {
      const url = new URL('/map-list.html',location.origin);
      url.search = point.query;
      url.searchParams.set('p11',point.id);
      url.searchParams.set('p14',point.cases);
      url.searchParams.set('p13','0');
      const rows = new Map();
      let offset = 0;
      while (true) {
        url.searchParams.set('p12',String(offset));
        const response = await fetch(url.href,{mode:'same-origin',credentials:'same-origin',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
        if (response.status===429 || response.status===403) pauseUntil=Date.now()+120000;
        if (!response.ok) throw Error('點位讀取失敗');
        const text = await response.text();
        if (signal.aborted || text.length>3000000) return null;
        const data = JSON.parse(text).content;
        if (!data || Number(data.totalRows)!==point.count || typeof data.subContent!=='string') return null;
        const template = document.createElement('template');
        template.innerHTML = data.subContent;
        const replyPoint=template.content.querySelector('#hid_collectids')?.getAttribute('data-collectids');
        const before = rows.size;
        for (const card of template.content.querySelectorAll('.property_list > li')) {
          const facts = cardFacts(card);
          const group = card.getAttribute('data-collect-id');
          if (!facts.id || !belongsToPoint(point,group,replyPoint)) return null;
          rows.set(facts.id,facts);
        }
        if (rows.size===point.count) return [...rows.values()];
        const click = template.content.querySelector('.pageNext')?.getAttribute('onclick') || '';
        const page = click.match(/^\s*jsPage\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*;?\s*$/);
        if (rows.size===before || !page || Number(page[2])!==point.count || Number(page[1])<=offset || Number(page[1])>=point.count) return null;
        offset = Number(page[1]);
        if (signal.aborted) return null;
      }
    }
    function queuePoints(todo,key,markerCount,hiddenCount,hide) {
      if (pointScope!==key) {
        pointRun?.abort();
        pointScope=key; pointRun=new AbortController(); failedPoints.clear();
      }
      pendingPoints=todo;
      const candidates=[...todo.keys()];
      const unverified=candidates.filter(k=>failedPoints.has(k)).length;
      const left=candidates.filter(k=>!failedPoints.has(k)&&!cached(k)).length;
      const message=(active||hide) ? '辨識 '+markerCount+' 個房源點位，已隱藏 '+hiddenCount+' 個。'+(key?'待讀 '+left+' 個'+(unverified?'，明細未能確認 '+unverified+' 個，可按套用重試。':'。'):'等待地圖查詢範圍。') : '';
      if(find('pointStatus').textContent!==message)find('pointStatus').textContent=message;
      if(!left)return;
      if(Date.now()<pauseUntil){
        if(!resumeTimer)resumeTimer=setTimeout(()=>{resumeTimer=null;repaint();},pauseUntil-Date.now()+50);
        return;
      }
      for(const [k,point] of pendingPoints){
        if(inFlight.size>=3)break;
        if(inFlight.has(k)||failedPoints.has(k)||cached(k))continue;
        const signal=pointRun.signal;
        inFlight.add(k);
        readPoint(point,signal).then(rows=>{
          if(signal.aborted)return;
          if(rows)remember(k,rows);
          else failedPoints.add(k);
        }).catch(()=>{if(!signal.aborted)failedPoints.add(k);}).finally(()=>{
          inFlight.delete(k);schedulePaint();
        });
      }
    }
    return {updateScope(){if(active&&scope!==region())start(active);}, update(seen,hide){
      const groupsOnPage = new Map();
      for(const card of document.querySelectorAll('#props_result .property_list > li')){
        const id=RentHelper.idOf(card.querySelector('.title a')?.getAttribute('href'));
        const desc=card.querySelector('.proname .c > p:last-child')?.textContent.trim()||'';
        const price=Number(card.querySelector('.price em')?.textContent.replace(/[,元\s]/g,''));
        const rawType = desc.split('/')[0].trim();
        if (id && typeKeys.get(rawType)?.length === 1) knownTypes.set(id,rawType);
        const type = knownTypes.get(id) || rawType;
        const reject=!!active&&(excluded(id)||factMismatch(active,type,price,desc));
        card.classList.toggle('rh-map-excluded',!!id&&reject);
        const pending = active && !reject && !complete && !visited.has(id);
        let hint = card.querySelector('.rh-map-pending');
        if (pending && !hint) {
          hint = document.createElement('small');
          hint.className = 'rh-map-pending';
          hint.textContent = ' 條件待核對';
          card.querySelector('.title')?.append(hint);
        } else if (!pending && hint) hint.remove();
        const group = card.getAttribute('data-collect-id');
        if (group && id) {
          if (!groupsOnPage.has(group)) groupsOnPage.set(group,new Map());
          groupsOnPage.get(group).set(id,reject || (hide && seen(id)));
        }
      }
      const resultPane=document.getElementById('props_result');
      const sourcePoint=resultPane?.querySelector('#hid_collectids')?.getAttribute('data-collectids');
      const sidebarCards=resultPane?.querySelectorAll('.property_list > li') || [];
      const hiddenOnPage=[...sidebarCards].filter(card=>card.classList.contains('rh-map-excluded') || card.classList.contains('rh-hidden')).length;
      let reason=resultPane?.querySelector('.rh-empty-reason');
      if(sidebarCards.length && hiddenOnPage===sidebarCards.length){
        if(!reason){
          reason=document.createElement('p');reason.className='rh-empty-reason';
          reason.setAttribute('role','status');resultPane.prepend(reason);
        }
        const message='本頁 '+hiddenOnPage+' 篇刊登都已被目前的篩選或已讀設定隱藏。可點其他地圖點，或到「地圖篩選・已讀」調整條件。';
        if(reason.textContent!==message)reason.textContent=message;
      }else reason?.remove();
      const params=viewParams();
      const query=params.toString();
      // 591 l21–l44 describe zoom, center and viewport. IDs identify the point itself.
      for(const name of ['l21','l22','l23','l31','l32','l33','l41','l42','l43','l44'])params.delete(name);
      const key=(active||hide) && params.get('l11')==='1' ? params.toString() : '';
      const todo=new Map();
      const hiddenIds = new Set();
      const markers=document.querySelectorAll('.marker[propnum]');
      for(const marker of markers){
        const id=marker.getAttribute('postid');
        const single=marker.getAttribute('propnum')==='1'&&/^\d+$/.test(id||'');
        const members = groupsOnPage.get(marker.getAttribute('collectid')) ||
          (sourcePoint===marker.id && marker.getAttribute('casesid')!=='0' && groupsOnPage.get(marker.getAttribute('casesid')));
        const allHidden = members && members.size === Number(marker.getAttribute('propnum')) && [...members.values()].every(Boolean);
        let hidden=allHidden || (single&&(excluded(id)||(hide&&seen(id))));
        const point={query,id:marker.id,cases:marker.getAttribute('casesid')||'0',collect:marker.getAttribute('collectid'),count:Number(marker.getAttribute('propnum'))};
        if (key && !hidden && !(single && !active) && (!members || members.size!==point.count) && /^\d+$/.test(point.id) && /^\d+$/.test(point.cases) && Number.isSafeInteger(point.count) && point.count>0) {
          const index='point:'+JSON.stringify([key,point.id,point.collect,point.cases,point.count,id]);
          todo.set(index,point);
          const rows=cached(index);
          if(rows) hidden=rows.every(row=>rejected(row)||(hide&&seen(row.id)));
        }
        marker.classList.toggle('rh-map-excluded',!!hidden);
        marker.toggleAttribute('data-rh-hide-point',!!hidden);
        if(hidden)hiddenIds.add(marker.id);
      }
      for(const label of document.querySelectorAll('[id^="map2_commname_default_"]')){
        label.toggleAttribute('data-rh-hide-point',hiddenIds.has(label.id.slice('map2_commname_default_'.length)));
      }
      queuePoints(todo,key,markers.length,hiddenIds.size,hide);
    }};
  }
  globalThis.RentMap={capture,setup,factMismatch,belongsToPoint};
})();
