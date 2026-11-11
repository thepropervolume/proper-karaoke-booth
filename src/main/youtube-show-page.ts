import { youtubeEmbedUrl } from './youtube-player-page';

/** Only fixed application code and a validated video ID enter this isolated page. */
export function youtubeShowPage(videoId: string, origin: string): string {
  youtubeEmbedUrl(videoId);
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Invalid player origin.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube — Singer Display</title><style>
html,body{width:100%;height:100%;max-height:100vh;margin:0;overflow:hidden;background:#090e18;color:#f4f2e9;font:16px system-ui,sans-serif}body{height:100vh;height:100dvh;max-height:100vh;display:grid;grid-template-rows:auto minmax(0,1fr) auto}header,footer{padding:clamp(4px,1.5vh,12px) 20px;text-align:center;overflow-wrap:anywhere}main{position:relative;min-width:0;min-height:0;overflow:hidden}#player{position:absolute;inset:0;display:block;width:100%;height:100%;max-height:100vh;border:0}footer{font-size:clamp(10px,2vh,13px);color:#b9c2d0}
</style></head><body><header id="caption">YouTube · Preparing song</header><main><div id="player"></div></main><footer>YouTube · System audio output · Native player controls remain available</footer><script>
let player, ready=false, error=null, wanted='paused', title='YouTube', position=0;
window.onYouTubeIframeAPIReady=()=>{player=new YT.Player('player',{videoId:${JSON.stringify(videoId)},playerVars:{controls:1,playsinline:1,autoplay:0,origin:${JSON.stringify(origin)}},events:{
onReady:()=>{player.pauseVideo();ready=true;},onError:e=>{error=Number(e.data)||1;},onAutoplayBlocked:()=>{error=999;}
}});};
window.tpvYouTube={snapshot:()=>({ready,error,state:ready?player.getPlayerState():-1,position:ready?player.getCurrentTime():0,duration:ready?player.getDuration():0}),
set:value=>{wanted=value.status;document.getElementById('caption').textContent=value.caption; if(!ready)return;player.setVolume(Math.round(value.volume*100)); if(wanted==='playing')player.playVideo();else player.pauseVideo();},
seek:value=>{if(!ready)throw Error('Player not ready');player.seekTo(value,true);if(wanted==='paused')player.pauseVideo();return player.getCurrentTime();}};
</script><script src="https://www.youtube.com/iframe_api"></script></body></html>`;
}
