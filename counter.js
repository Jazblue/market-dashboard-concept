(function() {
  var el = document.getElementById('visitor-count');
  if (!el) return;
  try {
    fetch('https://countapi.mileshilliard.com/api/v1/hit/market-dashboard-concept')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        el.textContent = Number(data.value || 0).toLocaleString();
      })
      .catch(function() { el.textContent = 'unavailable'; });
  } catch (e) { el.textContent = 'unavailable'; }
})();
