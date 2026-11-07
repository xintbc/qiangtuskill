
/* 3D 引擎兜底：外网 CDN 拉不到时，自动从局域网服务器（或上次连过的服务器）取一份 → 内网/断网也能玩 */
(function(){
  if(typeof THREE!=='undefined')return;
  var hosts=[];
  try{var s=localStorage.getItem('gunGame.netServer.v1');if(s)hosts.push(s);}catch(e){}
  hosts.push('localhost:8765');hosts.push('127.0.0.1:8765');
  for(var i=0;i<hosts.length;i++){
    var h=String(hosts[i]).replace(/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//,'').replace(/\/.*$/,'');
    if(!h)continue;
    if(!/:\d+$/.test(h))h=h+':8765';
    try{
      var x=new XMLHttpRequest();
      x.open('GET','http://'+h+'/libs/three.r128.min.js',false);
      x.send(null);
      if(x.status===200&&x.responseText&&x.responseText.length>10000){(0,eval)(x.responseText);break;}
    }catch(e){}
  }
})();
