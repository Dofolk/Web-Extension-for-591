const notice=s=>{document.getElementById('notice').textContent=s;};
function validRecords(data){
  if(!data||data.version!==1||!data.records||typeof data.records!=='object'||Array.isArray(data.records))throw new Error('備份格式不正確');
  const entries=Object.entries(data.records);if(entries.length>20000)throw new Error('最多可還原 20,000 筆紀錄');
  for(const[k,v]of entries)if(!/^rhSeen:\d{1,20}$/.test(k)||!Number.isSafeInteger(v)||v<=0||v>Date.now()+86400000)throw new Error('紀錄格式不正確');
  return entries;
}
document.getElementById('export').onclick=async e=>{
  if(!e.isTrusted)return;
  try{const all=await chrome.storage.local.get(null);const records=Object.fromEntries(Object.entries(all).filter(([k,v])=>/^rhSeen:\d{1,20}$/.test(k)&&Number.isSafeInteger(v)&&v>0));
    const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,records},null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='591-seen-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);notice('已建立備份。');
  }catch(err){notice('匯出失敗：'+err.message);}
};
document.getElementById('restore').onchange=async e=>{
  if(!e.isTrusted)return;
  try{const file=e.target.files[0];if(!file)return;if(file.size>5000000)throw new Error('檔案過大');const entries=validRecords(JSON.parse(await file.text()));
    const current=await chrome.storage.local.get(entries.map(([k])=>k));const records=Object.fromEntries(entries.map(([k,v])=>[k,Math.max(Number.isSafeInteger(current[k])?current[k]:0,v)]));
    await chrome.storage.local.set(records);notice(`已合併 ${entries.length} 筆紀錄。`);
  }catch(err){notice('還原失敗：'+err.message);}finally{e.target.value='';}
};
