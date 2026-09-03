// Fluid V5 M7.1.4.1 mobile settings viewport hotfix.
// The page intentionally locks body scrolling for the WebGPU canvas, so the fixed settings card
// must own its own vertical scroll region on phones. Without a viewport cap, the expanded water,
// realism, physics and scenario controls extend below the visible iOS browser viewport.

const STYLE_ID='fluidV5MobileSettingsScrollM7141';
if(!document.getElementById(STYLE_ID)){
 const style=document.createElement('style');
 style.id=STYLE_ID;
 style.textContent=`
#settingsPanel.settings{
 max-height:calc(100dvh - 116px - env(safe-area-inset-bottom));
 overflow-y:auto;
 overflow-x:hidden;
 overscroll-behavior:contain;
 touch-action:pan-y;
 -webkit-overflow-scrolling:touch;
 padding-bottom:max(16px,calc(env(safe-area-inset-bottom) + 8px));
}
@media(max-width:600px){
 #settingsPanel.settings{
  max-height:calc(100dvh - 106px - env(safe-area-inset-bottom));
 }
}
@supports not (height:100dvh){
 #settingsPanel.settings{max-height:calc(100vh - 116px - env(safe-area-inset-bottom));}
 @media(max-width:600px){
  #settingsPanel.settings{max-height:calc(100vh - 106px - env(safe-area-inset-bottom));}
 }
}
`;
 document.head.appendChild(style);
}

window.__v5MobileSettingsScroll={online:true,version:'M7.1.4.1',dynamicViewport:true,internalScroll:true};
console.info('[Fluid V5 M7.1.4.1] mobile settings panel constrained to the visible viewport with touch scrolling.');
