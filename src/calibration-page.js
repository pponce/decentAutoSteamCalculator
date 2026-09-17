function mountCalibrationPage({ form, labels, save, back, status, request, base, field, updateChoices, syncFlow, flowPlan }, captureWeight) {
  const sizes = ['small', 'medium', 'large'];
  let samples = [], zeroConfirmed = false, awaitingZero = false, tarePending = false;
  let captured = null, token = null, active = false, pending = false, timer = null, closed = false;
  let sessionPhase = 'idle';
  let returnAfterRestore = false, appliedResult = false, scaleSocket = null;
  const make = (tag, text) => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
  const button = (text, parent, action, feedback) => {
    const element = make('button', text); element.type = 'button'; parent.append(element);
    element.addEventListener('click', async () => {
      try { await action(); } catch (error) { (feedback || runStatus).textContent = error.message; }
    });
    return element;
  };
  const weights = labels.smallPitcherGrams.closest('fieldset');
  const scaleBox = make('div'); scaleBox.className = 'pitcher-section-header full-width';
  const scaleHeading = make('div');
  const scaleTitle = make('h3', 'Empty pitcher weights');
  const scaleValue = make('span', 'Scale disconnected. Manual entry is available.'); scaleValue.className = 'scale-reading';
  scaleHeading.append(scaleTitle, scaleValue);
  const scaleTools = make('div'); scaleTools.className = 'scale-tools';
  const scaleHelp = make('p', 'Tare with nothing on the scale. Wait for zero, then place an empty pitcher.');
  scaleHelp.className = 'visually-hidden'; scaleHelp.setAttribute('role', 'status');
  scaleBox.append(scaleHeading, scaleTools, scaleHelp);
  weights.insertBefore(scaleBox, labels.smallPitcherGrams);
  const guided = make('div'); guided.className = 'guided-calibration guided-workspace';
  const flowLabel = make('label', 'Auto flow / default (ml/s)'); flowLabel.className = 'field calibration-flow';
  const flow = make('input'); flow.id = 'calibration-flow'; flow.type = 'number'; flow.min = '0.4'; flow.max = '2.5'; flow.step = '0.1'; flow.value = field('referenceFlow').value;
  flow.addEventListener('input', () => syncFlow(flow.value)); flowLabel.append(flow); guided.append(flowLabel);
  const guidedBlock = make('div'); guidedBlock.className = 'calibration-workspace-block'; guided.append(guidedBlock);
  const weighStep = make('div'); weighStep.className = 'guided-overview';
  const pitcherLabel = make('label', 'Calibration pitcher'); pitcherLabel.className = 'field';
  const pitcher = make('select'); pitcher.setAttribute('aria-label', 'Calibration pitcher'); pitcherLabel.append(pitcher); weighStep.append(pitcherLabel);
  const readings = make('div'); readings.className = 'guided-readouts';
  const scaleMetric = make('div'); scaleMetric.className = 'guided-metric'; scaleMetric.append(make('b', 'Scale reading:'));
  const calibrationScaleValue = make('span', 'disconnected'); scaleMetric.append(calibrationScaleValue);
  const milkMetric = make('div'); milkMetric.className = 'guided-metric'; milkMetric.append(make('b', 'Derived milk weight (g):'));
  const derivedMilk = make('span', '—'); milkMetric.append(derivedMilk); readings.append(scaleMetric, milkMetric); weighStep.append(readings);
  const milkActions = make('div'); milkActions.className = 'calibration-actions guided-actions'; weighStep.append(milkActions);
  const milk = make('p', 'Tare, then capture a fresh stable milk weight.'); milk.className = 'local-status'; milk.setAttribute('role', 'status'); milk.setAttribute('aria-live', 'polite');
  guidedBlock.append(weighStep, milk);
  const steamStep = make('div'); steamStep.className = 'guided-steam-controls';
  const elapsedLabel = make('span', 'Time elapsed: '); elapsedLabel.className = 'timer-readout';
  const elapsed = make('span', '0.0 s'); elapsed.className = 'calibration-timer'; elapsedLabel.append(elapsed); steamStep.append(elapsedLabel);
  const runStatus = make('span', 'Waiting for milk capture'); runStatus.className = 'machine-state';
  runStatus.setAttribute('role', 'status'); runStatus.setAttribute('aria-live', 'polite'); steamStep.append(runStatus);
  const actions = make('div'); actions.className = 'calibration-actions'; steamStep.append(actions);
  guidedBlock.append(steamStep);
  const manual = labels.referenceMilkGrams.closest('fieldset');
  manual.className += ' manual-fields';
  const calibrationPanel = manual.parentElement;
  calibrationPanel.insertBefore(guided, manual);
  const review = make('div'); review.className = 'manual-workspace';
  calibrationPanel.insertBefore(review, manual); review.append(manual);
  function setScaleMessage(text) {
    scaleValue.textContent = text;
    calibrationScaleValue.textContent = text.replace(/^Scale(?: reading)?:\s*/i, '');
  }
  const captureButtons = [];
  function weight() {
    if (!zeroConfirmed || tarePending || awaitingZero) throw new Error('Tare the empty scale and wait for a stable zero first.');
    return captureWeight(samples, Date.now());
  }
  function clearCapture() {
    captured = null;
    milk.textContent = 'Tare, then capture a fresh stable milk weight.';
    derivedMilk.textContent = '—';
    elapsed.textContent = '0.0 s';
    if (!active && !pending) runStatus.textContent = 'Waiting for milk capture';
  }
  async function tare() {
    if (active || pending) throw new Error('Finish or cancel calibration before taring.');
    zeroConfirmed = false; awaitingZero = false; tarePending = true; samples = []; clearCapture(); paint();
    try {
      await request('/api/v1/scale/tare', { method: 'PUT' });
      samples = []; awaitingZero = true;
      setScaleMessage('Keep the scale empty. Waiting for a stable zero…');
      scaleHelp.textContent = milk.textContent = 'Wait for a stable zero before placing the pitcher.';
    } finally { tarePending = false; paint(); }
  }
  const tarePitchers = button('Tare empty scale', scaleTools, tare, scaleHelp);
  const pitcherGrid = make('div'); pitcherGrid.className = 'pitcher-grid full-width';
  for (const size of sizes) {
    const result = make('p'); result.className = 'capture-result'; result.setAttribute('role', 'status');
    const capture = button('Set from scale', labels[size + 'PitcherGrams'], () => {
      const value = weight();
      if (value < 1 || value > 3000) throw new Error('Place an empty pitcher on the scale (1–3000 g).');
      field(size + 'PitcherGrams').value = value;
      clearCapture(); updateChoices(); updatePitchers();
      result.textContent = size[0].toUpperCase() + size.slice(1) + ' pitcher set to ' + value + ' g.';
    }, result);
    capture.className = 'capture-button'; labels[size + 'PitcherGrams'].append(result); captureButtons.push(capture);
  }
  pitcherGrid.append(...sizes.map(size => labels[size + 'PitcherGrams'])); weights.append(pitcherGrid);
  const tareMilk = button('Tare', milkActions, tare, milk);
  const captureMilk = button('Capture pitcher + milk (g)', milkActions, async () => {
    const tared = field('weightMode').value === 'tared';
    const size = pitcher.value, pitcherGrams = tared ? 0 : Number(field(size + 'PitcherGrams')?.value);
    if (!tared && (!sizes.includes(size) || !(pitcherGrams >= 1 && pitcherGrams <= 3000))) throw new Error('Configure and choose a pitcher first.');
    const total = weight(), milkGrams = Math.round((total - pitcherGrams) * 10) / 10;
    const name = tared ? 'Tared' : size[0].toUpperCase() + size.slice(1);
    if (milkGrams < 10) throw new Error('Milk < 10 g · ' + name + ' pitcher');
    if (milkGrams > 1500) throw new Error('Milk > 1500 g · ' + name + ' pitcher');
    captured = { pitcher: tared ? null : size, pitcherGrams, milkGrams };
    derivedMilk.textContent = String(milkGrams);
    milk.textContent = 'Milk weight captured. Start steam now, then stop steam when the milk reaches ' + flowPlan.currentTargetLabel() + '.';
    pending = true; appliedResult = false; paint();
    try {
      const heaterTemperature = Number(new URL(window.location.href).searchParams.get('steamHeaterTemperature'));
      await command('begin', { ...captured, flow: flowPlan.currentFlow(),
        ...(Number.isInteger(heaterTemperature) && heaterTemperature >= 135 && heaterTemperature <= 165 ? { heaterTemperature } : {}) });
    } finally {
      pending = false; paint();
      if (returnAfterRestore && active) await command('cancel');
    }
  }, milk);
  async function command(action, values = {}) {
    try {
      const result = await request(base + '/calibration', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, token, ...values }) });
      accept(result);
      return result;
    } catch (error) {
      if (error.data?.token) accept(error.data);
      throw error;
    }
  }
  function schedule() {
    if (timer !== null || !active || closed) return;
    timer = setTimeout(async () => {
      timer = null;
      try { await command('heartbeat'); }
      catch (error) { runStatus.textContent = error.message + ' If steaming, use the machine’s stop control.'; }
      finally { schedule(); }
    }, 500);
  }
  function accept(value) {
    sessionPhase = value.phase;
    token = value.token ?? token; active = value.active === true;
    runStatus.textContent = value.message || ({ armed: 'Waiting for machine steam', starting: 'Waiting for machine steam', heating: 'Heating · Timer waiting', steaming: 'Machine steam detected · Timing', restoring: 'Restoring previous steam settings…' }[value.phase] ?? value.phase);
    elapsed.textContent = Number(value.seconds || 0).toFixed(1) + ' s';
    if (value.result && !appliedResult) {
      appliedResult = true; captured = null;
      flowPlan.acceptMeasurement(value.result);
      review.open = true;
      runStatus.textContent = 'Machine steam stopped';
      milk.textContent = 'Need to try again? Capture pitcher + milk weight again to start a new timer.';
    }
    paint(); schedule();
    if (returnAfterRestore && !active) { closed = true; window.location.assign(back.href); }
  }
  const cancel = button('Cancel calibration', actions, () => command('cancel'));
  function paint() {
    const locked = active || pending;
    for (const key of Object.keys(labels)) field(key).disabled = locked;
    flow.disabled = locked;
    flowPlan.lock(locked);
    if (!locked) updateChoices();
    for (const control of [tarePitchers, tareMilk, ...captureButtons, captureMilk, pitcher]) control.disabled = locked || tarePending;
    cancel.disabled = !active;
    cancel.hidden = !active;
    save.disabled = locked;
    const tared = field('weightMode').value === 'tared';
    pitcherLabel.hidden = tared;
    weighStep.className = 'guided-overview' + (tared ? ' is-tared' : '');
    captureMilk.textContent = tared ? 'Capture milk only (g)' : 'Capture pitcher + milk (g)';
    scaleHelp.textContent = zeroConfirmed ? (tared ? 'Zero confirmed with the empty pitcher. Add milk, then capture.' : 'Zero confirmed. Place pitcher plus milk, then capture.') : (tared ? 'Place the empty pitcher on the scale, then tare.' : 'Tare with nothing on the scale.');
  }
  function updatePitchers() {
    const previous = pitcher.value;
    pitcher.replaceChildren();
    for (const size of sizes) {
      const grams = Number(field(size + 'PitcherGrams').value);
      if (!(grams >= 1 && grams <= 3000)) continue;
      const option = make('option', size[0].toUpperCase() + size.slice(1)); option.value = size; pitcher.append(option);
    }
    if (sizes.includes(previous) && Number(field(previous + 'PitcherGrams').value) >= 1) pitcher.value = previous;
    paint();
  }
  form.addEventListener('input', event => {
    if (event.target === pitcher || event.target?.name?.endsWith('PitcherGrams')) { clearCapture(); updatePitchers(); }

  });
  pitcher.addEventListener('change', () => { clearCapture(); paint(); });
  field('weightMode').addEventListener('change', () => { clearCapture(); zeroConfirmed = false; paint(); });
  back.addEventListener('click', async event => {
    if (!active && !pending) return;
    event.preventDefault(); returnAfterRestore = true;
    if (pending) return;
    try { await command('cancel'); } catch (error) { status.textContent = error.message; }
  });
  function connectScale() {
    if (closed) return;
    const url = new URL('/ws/v1/scale/snapshot', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    scaleSocket = new WebSocket(url.href);
    scaleSocket.onmessage = event => {
      let data; try { data = JSON.parse(event.data); } catch { return; }
      if (data.status === 'disconnected' || data.status === 'connected') {
        samples = []; zeroConfirmed = false; awaitingZero = false;
        if (!active) clearCapture();
        setScaleMessage(data.status === 'connected' ? 'Scale connected. Tare the empty scale before capture.' : 'Scale disconnected. Reconnect and tare the empty scale before capture.'); paint(); return;
      }
      if (!Number.isFinite(data.weight) || tarePending) return;
      const now = Date.now();
      samples.push({ weight: data.weight, at: now }); samples = samples.filter(s => now - s.at <= 2500).slice(-64);
      if (awaitingZero) {
        try {
          if (Math.abs(captureWeight(samples, now)) <= 0.5) {
            awaitingZero = false; zeroConfirmed = true; samples = [];
            setScaleMessage('Scale reading: 0.0 g - stable');
            scaleHelp.textContent = milk.textContent = 'Zero confirmed. Now place the pitcher on the scale.';
          }
        } catch {}
      } else {
        let stable = false;
        try { captureWeight(samples, now); stable = true; } catch {}
        setScaleMessage('Scale: ' + data.weight.toFixed(1) + ' g · ' + (stable ? 'Stable' : 'Settling…'));
        if (!zeroConfirmed) scaleHelp.textContent = milk.textContent = 'Tare the empty scale before capture.';
      }
    };
    scaleSocket.onclose = () => {
      samples = []; zeroConfirmed = false; awaitingZero = false;
      if (!active) clearCapture();
      setScaleMessage('Scale connection lost. Reopen settings to reconnect, or enter weights manually.'); paint();
    };
  }
  window.addEventListener('pagehide', () => {
    closed = true;
    if (timer !== null) clearTimeout(timer);
    scaleSocket?.close();
    if (active && token) fetch(base + '/calibration', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel', token }) }).catch(() => {});
  });
  flowPlan.attach(guided, review, flowLabel, () => { clearCapture(); zeroConfirmed = false; samples = []; appliedResult = false; elapsed.textContent = '0.0 s'; paint(); });
  updatePitchers();
  connectScale();
  return { isActive: () => active || pending, flowChanged() { appliedResult = false; runStatus.textContent = 'Flow changed. Repeat calibration or enter a time measured at this flow.'; }, assertCanSave() { if (active || pending) throw new Error('Finish or cancel calibration before saving.'); } };
}
