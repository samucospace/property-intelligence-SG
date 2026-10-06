import React, {useEffect, useRef} from 'react';

export default function AccessibleDialog({label,onClose,children,...props}) {
  const root=useRef(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const controls=()=>Array.from(root.current.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')).filter(element=>!element.disabled && element.getClientRects().length);
    (controls()[0] || root.current).focus();
    const onKey=event=>{
      if(event.key==='Escape') {event.preventDefault();event.stopPropagation();close.current();}
      if(event.key==='Tab') {
        const elements=controls(),first=elements[0],last=elements.at(-1);
        if(!first) {event.preventDefault();root.current.focus();}
        else if(event.shiftKey && (document.activeElement===first || document.activeElement===root.current)) {event.preventDefault();last.focus();}
        else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first.focus();}
      }
    };
    const keepFocus=event=>{if(root.current && !root.current.contains(event.target)) (controls()[0] || root.current).focus();};
    document.addEventListener('keydown',onKey);document.addEventListener('focusin',keepFocus);
    return ()=>{document.removeEventListener('keydown',onKey);document.removeEventListener('focusin',keepFocus);document.body.style.overflow=overflow;if(previous?.isConnected) previous.focus();};
  },[]);
  return <div {...props} ref={root} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</div>;
}
