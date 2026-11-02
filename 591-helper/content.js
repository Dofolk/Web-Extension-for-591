(async () => {
  if(document.getElementById('rent-helper-root')) return;
  const H=RentHelper;
  let store=await chrome.storage.local.get(null), hide=!!store.rhHide, busy=false;
  let results=new Map(), queues=[], runBase='', lastURL=location.href, detailMarked=null;
  const host=document.createElement('div');host.id='rent-helper-root';document.documentElement.append(host);
  const root=host.attachShadow({mode:'closed'});
  root.innerHTML=`<style>
  :host{all:initial;font-family:system-ui,"Microsoft JhengHei",sans-serif;color:#18332d;font-size:14px}
  *{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;border:1px solid #c6d9d2;background:white;border-radius:9px;padding:8px 12px;color:#18332d}button:hover{background:#e8f3ed}button:disabled{opacity:.5;cursor:wait}a{color:#146b57}label{display:inline-flex;gap:7px;align-items:center;margin:6px 12px 6px 0}input{accent-color:#16785f}
  #toggle{position:fixed;right:22px;bottom:24px;z-index:2147483647;background:#155e4b;color:white;box-shadow:0 4px 24px #0003}
  #panel{position:fixed;right:22px;top:70px;bottom:80px;width:min(560px,calc(100vw - 32px));z-index:2147483646;background:#f8fbf9;border:1px solid #cadbd4;border-radius:16px;box-shadow:0 12px 50px #0003;overflow:auto;padding:22px}
  [hidden]{display:none!important}h2{font-size:21px;margin:0 0 8px}p{line-height:1.65}.muted{color:#60766d;font-size:12px}#search{background:#155e4b;color:white}#status{white-space:pre-line;font-size:13px;line-height:1.6}article{padding:16px;background:white;border:1px solid #dae6df;border-radius:12px;margin-top:12px}article.seen{opacity:.6}article a{font-weight:650;font-size:16px;text-decoration:none}article p{font-size:13px;margin:9px 0}.price{font-weight:bold;color:#a84d22}#close{float:right}#detail{margin:12px 0}#tools{border-top:1px solid #d7e3dd;margin-top:20px;padding-top:12px}#restore{max-width:100%}
  </style><button id="toggle">⌂ 租屋小幫手</button><section id="panel" hidden><button id="close" aria-label="關閉">✕</button><h2>找房，從沒看過的開始</h2><p class="muted">已看過紀錄只保存在這個 Edge 設定檔。</p><label><input type="checkbox" id="hide">隱藏已看過</label><div id="detail"></div><div id="searchArea"><p>租屋類型（可複選）</p><div id="kinds"></div><p class="muted">沿用目前網址的地區、租金等條件。每次載入各房型一頁，合併去重；清單依房型及原站順序排列，不是跨房型全域排序。</p><button id="search">搜尋選取房型</button> <button id="more" hidden>載入各房型下一頁</button><p id="status" role="status"></p><div id="sources"></div><div id="results"></div></div><div id="tools"><p class="muted">備份／還原請點 Edge 工具列的擴充功能圖示。本機紀錄與備份未加密；網頁可觀察已顯示的看過標記。</p><p class="muted" id="notice"></p></div></section>`;
  const filterHost = document.createElement('div');
  filterHost.id = 'rh-inline-filters';
  const listHost = document.createElement('div');
  listHost.id = 'rh-merged-list';
  const filters = filterHost.attachShadow({mode:'closed'});
  const list = listHost.attachShadow({mode:'closed'});
  for (const target of [filters, list]) target.append(root.querySelector('style').cloneNode(true));
  const $ = selector => root.querySelector(selector) || filters.querySelector(selector) || list.querySelector(selector);
  for (const target of [root, filters, list]) {
    target.addEventListener('click', e => {
      if (!e.isTrusted) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    target.addEventListener('change', e => { if (!e.isTrusted) e.stopImmediatePropagation(); }, true);
  }
  const filterBar = document.createElement('div');
  filterBar.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 0';
  const label = document.createElement('strong');
  label.textContent = '房型多選';
  const cancelKinds = document.createElement('button');
  cancelKinds.type = 'button';
  cancelKinds.id = 'cancel-kinds';
  cancelKinds.textContent = '取消套用';
  filterBar.append(label, $('#kinds'), $('#search'), cancelKinds);
  filters.append(filterBar);
  $('#search').textContent = '套用多選';
  const listTitle = document.createElement('h2');
  listTitle.textContent = '多房型搜尋結果';
  const back = document.createElement('button');
  back.textContent = '返回原列表';
  const sortLabel = document.createElement('label');
  sortLabel.textContent = '已載入房源排序 ';
  const sort = document.createElement('select');
  for (const [value,text] of [['seconds','最近更新優先'],['rent','租金由低到高'],['-rent','租金由高到低'],['ping','坪數由小到大'],['-ping','坪數由大到小']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    sort.append(option);
  }
  const nativeOrder = document.createElement('option');
  nativeOrder.value = 'native';
  nativeOrder.textContent = '原本這一頁優先（591 原順序）';
  sort.append(nativeOrder);
  sort.onchange = render;
  sortLabel.append(sort);
  list.append(listTitle, back, sortLabel, $('#status'), $('#sources'), $('#results'), $('#more'));
  $('#results').after(document.createElement('slot'));
  const hint = $('#searchArea');
  hint.textContent = '在搜尋頁的「房型多選」勾選要找的類型，再按「套用多選」。';
  let generation = 0;
  function resetList() {
    picked.clear();
    updateBatchButton();
    generation++;
    runBase = '';
    busy = false;
    queues = [];
    results.clear();
    listHost.replaceChildren();
    listHost.hidden = true;
    $('#search').disabled = false;
    $('#more').hidden = true;
    mount();
  }
  back.onclick = () => { resetList(); refresh(); };
  cancelKinds.onclick = back.onclick;
  function mount() {
    if (!/^\/list\/?$/.test(location.pathname)) {
      filterHost.remove();
      listHost.remove();
      return;
    }
    const main = document.querySelector('.list-wrapper main') || document.querySelector('main');
    const row = document.querySelector('.kind.options-container');
    if (row) {
      if (filterHost.parentNode !== row) row.prepend(filterHost);
      for (const option of row.querySelectorAll('.filter-item')) {
        option.classList.toggle('rh-replaced-kind', Object.values(H.kinds).includes(option.textContent.trim()));
      }
    }
    if (!row && main && filterHost.parentNode !== main.parentNode) main.before(filterHost);
    const toolbar = main?.querySelector('.list-sort');
    if (toolbar && toolbar.nextElementSibling !== listHost) toolbar.after(listHost);
    else if (!toolbar && main && listHost.parentNode !== main) main.prepend(listHost);
    listHost.hidden = !runBase;
    cancelKinds.hidden = !runBase;
  }
  function notice(s){$('#notice').textContent=s;}
  const saved=Array.isArray(store.rhKinds)?store.rhKinds:['1','2'];
  for(const [id,name] of Object.entries(H.kinds)){
    const label=document.createElement('label'), box=document.createElement('input');box.type='checkbox';box.value=id;box.checked=saved.includes(id);label.append(box,document.createTextNode(name));$('#kinds').append(label);
  }
  const picked = new Set();
  const batchButton = document.createElement('button');
  batchButton.id = 'batch-read';
  batchButton.style.cssText = 'position:fixed;right:22px;bottom:76px;z-index:2147483647;background:#155e4b;color:white';
  batchButton.hidden = true;
  root.append(batchButton);
  let savingBatch = false;

  function updateBatchButton() {
    batchButton.hidden = picked.size === 0;
    batchButton.disabled = savingBatch;
    batchButton.textContent = '將勾選的 ' + picked.size + ' 篇標為已讀';
  }

  function selectionControl(id, title) {
    const label = document.createElement('label');
    label.className = 'rh-select';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = picked.has(id);
    input.disabled = seen(id);
    input.setAttribute('aria-label', '選取刊登：' + title);
    label.append(input, document.createTextNode('選取'));
    label.onclick = event => event.stopPropagation();
    input.onchange = event => {
      event.stopPropagation();
      if (!event.isTrusted || seen(id)) return;
      if (input.checked) picked.add(id);
      else picked.delete(id);
      updateBatchButton();
    };
    return label;
  }

  batchButton.onclick = async event => {
    if (!event.isTrusted || savingBatch || !picked.size) return;
    const ids = [...picked].filter(id => !seen(id));
    const timestamp = Date.now();
    const records = Object.fromEntries(ids.map(id => ['rhSeen:' + id, timestamp]));
    savingBatch = true;
    updateBatchButton();
    try {
      await chrome.storage.local.set(records);
      Object.assign(store, records);
      for (const id of ids) picked.delete(id);
      refresh();
      render();
    } catch (error) {
      $('#panel').hidden = false;
      notice('未能儲存已讀紀錄，請重試。' + error.message);
    } finally {
      savingBatch = false;
      updateBatchButton();
    }
  };
  const seen=id=>!!store['rhSeen:'+id];
  async function mark(id,value){try{const key='rhSeen:'+id;if(value){const v=Date.now();await chrome.storage.local.set({[key]:v});store[key]=v;}else{await chrome.storage.local.remove(key);delete store[key];}refresh();render();}catch(e){notice('紀錄儲存失敗：'+e.message);}}
  $('#toggle').onclick=()=>{$('#panel').hidden=!$('#panel').hidden;};$('#close').onclick=()=>{$('#panel').hidden=true;};
  $('#hide').checked=hide;
  $('#hide').onchange=async()=>{hide=$('#hide').checked;await chrome.storage.local.set({rhHide:hide});refresh();render();};
  const isMap = location.pathname === '/map-index.html';
  let mapControls = null;
  let lastPreset = '';
  function saveListPreset() {
    if (location.pathname !== '/list' || !document.querySelector('.kind.options-container')) return;
    const checked = [...filters.querySelectorAll('#kinds input')].filter(x => x.checked).map(x => x.value);
    const config = RentMap.capture(location.href, checked, document);
    const key = JSON.stringify(config);
    if (key !== lastPreset) {
      lastPreset = key;
      chrome.storage.local.set({rhListPreset:config}).catch(() => { lastPreset = ''; });
    }
  }
  filters.addEventListener('change',saveListPreset);
  if (isMap) {
    $('#toggle').textContent='地圖篩選・已讀';
    mapControls = RentMap.setup(root, store, refresh);
  }
  function refresh(){
    mount();
    for (const id of picked) if (seen(id)) picked.delete(id);
    updateBatchButton();
    saveListPreset();
    const cardSelector=isMap?'#props_result .property_list > li':'.item[data-id]';
    for(const card of document.querySelectorAll(cardSelector)){
      const title=card.querySelector(isMap?'.proname .title':'.item-info-title');
      const id=H.idOf(title?.querySelector('a')?.getAttribute('href'));if(!id)continue;
      card.classList.toggle('rh-seen',seen(id));card.classList.toggle('rh-hidden',hide&&seen(id));

      let control = card.querySelector('.rh-select');
      if (!control || control.dataset.listing !== id) {
        control?.remove();
        control = selectionControl(id, title.querySelector('a').textContent.trim());
        control.dataset.listing = id;
        title.prepend(control);
      }
      const input = control.querySelector('input');
      input.checked = picked.has(id);
      input.disabled = seen(id);
      let badge=card.querySelector('.rh-badge');
      if(!badge){badge=document.createElement('button');badge.type='button';badge.className='rh-badge';title.append(badge);badge.onclick=e=>{if(!e.isTrusted)return;e.preventDefault();e.stopPropagation();mark(id,!seen(id));};}
      const text=seen(id)?'✓ 已看過 · 取消':'標為已看過';if(badge.textContent!==text)badge.textContent=text;
    }
    mapControls?.update(seen,hide);
    const id=H.idOf(location.href);$('#searchArea').hidden=!!id;
    const detail=$('#detail');detail.replaceChildren();
    if(id){const b=document.createElement('button');b.textContent=seen(id)?'✓ 此物件已看過 · 取消標記':'標為已看過';b.onclick=()=>mark(id,!seen(id));detail.append(b);}
  }
  function render(){
    const area=$('#results');area.replaceChildren();let count=0;
    const mode = sort.value || 'seconds';
    const key = mode.replace('-','');
    const direction = mode.startsWith('-') ? -1 : 1;
    const ordered = [...results.values()];
    const originalRanks = new Map();
    if(mode==='native'){
      for(const card of document.querySelectorAll('main .item[data-id]')){
        if(!card.closest('#rh-merged-list'))originalRanks.set(card.dataset.id,originalRanks.size);
      }
    }
    ordered.sort((a,b) => {
      if(mode==='native')return (originalRanks.get(a.id) ?? Infinity) - (originalRanks.get(b.id) ?? Infinity) || a.seconds-b.seconds;
      if (a[key] == null || b[key] == null) return Number(a[key] == null) - Number(b[key] == null);
      return direction * (a[key] - b[key]) || 0;
    });
    const cards = document.createDocumentFragment();
    for(const item of ordered){
      if(hide&&seen(item.id))continue;
      count++;
      cards.append(item.card);
    }
    listHost.replaceChildren(cards);
    if (runBase) refresh();
    if(results.size){const p=document.createElement('p');p.className='muted';p.textContent=`已取得 ${results.size} 筆，顯示 ${count} 筆${hide ? '（已隱藏看過的 '+(results.size-count)+' 筆）' : ''}`;area.prepend(p);}
  }
  async function load(){
    if(busy)return;const current=generation;busy=true;$('#search').disabled=true;$('#more').disabled=true;
    const messages=[];
    try{
      for(const q of queues){
        if(current!==generation)return;
        if(!q.next)continue;
        $('#status').textContent=`正在讀取 ${H.kinds[q.kind]}…`;
        try{
          const response=await fetch(q.next,{credentials:'same-origin',mode:'same-origin',redirect:'error',signal:AbortSignal.timeout(20000)});
          if(!response.ok)throw new Error('HTTP '+response.status);
          const html=await response.text();
          if(current!==generation || runBase!==location.href)return;
          if(html.length>5000000)throw new Error('回應過大，已停止處理');
          const template=document.createElement('template');template.innerHTML=html;
          const data=H.parse(template.content,q.next,q.kind);
          let added=0;for(const item of data.items){if(!results.has(item.id))added++;results.set(item.id,item);}
          if(q.previousPage===data.items.map(item=>item.id).join(','))throw new Error('此頁與先前結果重複，請至原搜尋頁確認分頁。');
          q.previousPage=data.items.map(item=>item.id).join(',');q.next=data.next;
          messages.push(`${H.kinds[q.kind]}：新增 ${added} 筆${q.next?'':'（已到最後一頁）'}`);render();
        }catch(e){messages.push(`${H.kinds[q.kind]}：${e.message} 可按下一頁按鈕重試。`);}
      }
    }finally{if(current!==generation)return;busy=false;$('#search').disabled=false;$('#more').disabled=false;$('#more').hidden=!queues.some(q=>q.next);$('#status').textContent=messages.join('\n');}
  }
  $('#search').onclick=()=>applyKinds([...filters.querySelectorAll('#kinds input')].filter(x=>x.checked).map(x=>x.value));
  async function applyKinds(selected, includeNative=true){
    if(!selected.length){label.textContent='請至少勾選一種房型';return;}
    label.textContent='房型多選';
    if(!location.pathname.startsWith('/list')){$('#status').textContent='請先進入 591 搜尋結果頁並設定地區與租金。';return;}
    picked.clear();updateBatchButton();refresh();
    runBase=location.href;lastURL=runBase;generation++;busy=false;mount();
    listTitle.textContent='搜尋結果・'+selected.map(kind=>H.kinds[kind]).join('、');
    chrome.storage.local.set({rhKinds:selected}).catch(e=>notice(e.message));
    results.clear();
    if(includeNative){
      for(const card of document.querySelectorAll('main .item[data-id]')){
        if(card.closest('#rh-merged-list')) continue;
        const item=H.readCard(card,selected);
        if(item) results.set(item.id,item);
      }
    }
    render();
    queues=selected.map(kind=>({kind,next:H.searchURL(runBase,kind)}));$('#sources').replaceChildren();
    for(const q of queues){const a=document.createElement('a');a.href=q.next;a.target='_blank';a.rel='noopener';a.textContent=`${H.kinds[q.kind]}原搜尋頁 ↗`;a.style.marginRight='12px';$('#sources').append(a);}
    await load();
  };
  $('#more').onclick=()=>{if(location.href!==runBase){$('#status').textContent='搜尋條件已變更，請重新按「搜尋選取房型」。';return;}load();};
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local'||Object.keys(changes).every(key=>key.startsWith('rhCache1:')))return;for(const [k,v]of Object.entries(changes)){if(v.newValue===undefined)delete store[k];else store[k]=v.newValue;}hide=!!store.rhHide;$('#hide').checked=hide;refresh();render();});
  async function route(){const id=H.idOf(location.href);if(id&&detailMarked!==id){detailMarked=id;await mark(id,true);}if(!id)detailMarked=null;refresh();}
  let timer;
  new MutationObserver(mutations=>{
    if(!mutations.some(m=>m.addedNodes.length || m.removedNodes.length))return;
    if(runBase && runBase===location.href){
      const selected=queues.map(q=>q.kind);
      const candidates=new Set();
      for(const m of mutations){
        for(const node of m.addedNodes){
          if(node.nodeType!==1 || !node.closest('main') || node.closest('#rh-merged-list,.rh-select,.rh-badge'))continue;
          const card=node.closest('.item[data-id]');
          if(card)candidates.add(card);
          for(const child of node.querySelectorAll('.item[data-id]'))candidates.add(child);
        }
      }
      let added=false;
      for(const card of candidates){
        if(!card.isConnected || card.closest('#rh-merged-list') || results.has(card.dataset.id))continue;
        const item=H.readCard(card,selected);
        if(item && !results.has(item.id)){results.set(item.id,item);added=true;}
      }
      if(added)render();
    }
    if(!timer)timer=setTimeout(()=>{timer=null;refresh();},isMap?24:200);
  }).observe(document.body,{childList:true,subtree:true});
  function checkLocation() {
    if(location.href===lastURL)return;
    lastURL=location.href;
    if(isMap){mapControls?.updateScope();refresh();return;}
    if(runBase && /^\/list\/?$/.test(location.pathname)){
      applyKinds(queues.map(q=>q.kind),false);
      return;
    }
    resetList();route();
  }
  if(isMap && typeof window!=='undefined')window.addEventListener('hashchange',checkLocation);
  setInterval(checkLocation,1000);
  await route();
})();
