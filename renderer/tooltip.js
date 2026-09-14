const labelEl = document.getElementById('label');
const tipEl = document.getElementById('tip');

window.navigatorAPI.onState((payload) => {
  if (payload.type === 'hover-label') {
    labelEl.textContent = payload.text || '';
    requestAnimationFrame(() => {
      const width = Math.ceil(tipEl.getBoundingClientRect().width);
      window.navigatorAPI.reportTooltipWidth(width);
    });
  }
});
