function mountFlowCalibrationPage({ form, labels, field, updateChoices, syncFlow }, model) {
  const { calibrationLibrary, partitionFlowReadings, multipleCalibrationRequirements, calibrationKey, validFlowReading } = model;
  const make = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
  const panel = labels.referenceMilkGrams.closest('fieldset').parentElement;
  const manual = labels.referenceMilkGrams.closest('fieldset');
  const config = make('fieldset'); config.className = 'flow-setup';
  const configGrid = make('div'); configGrid.className = 'field-grid full-width'; config.append(configGrid);
  configGrid.append(labels.weightMode, labels.targetTemperatureC);
  const support = make('div'); support.className = 'field flow-support'; support.append(make('label', 'Flow support:'));
  const supportButtons = make('div'); supportButtons.className = 'calibration-actions'; support.append(supportButtons); configGrid.append(support);
  const single = make('button', 'Single'), multipleButton = make('button', 'Multiple');
  single.type = multipleButton.type = 'button'; single.id = 'flow-mode-single'; multipleButton.id = 'flow-mode-multiple';
  supportButtons.append(single, multipleButton);
  const range = make('div'); range.className = 'field-grid full-width'; range.append(labels.minimumFlow, labels.maximumFlow); config.append(range);
  const note = make('p'); note.className = 'local-status full-width'; note.setAttribute('role', 'status'); config.append(note);
  panel.insertBefore(config, manual);

  const main = make('section'); main.id = 'active-calibrations'; panel.insertBefore(main, manual);
  const others = make('details'); others.id = 'other-calibrations';
  others.append(make('summary', 'Other saved calibrations'));
  const otherRows = make('div'); others.append(otherRows); panel.insertBefore(others, manual);
  const editor = make('section'); editor.id = 'calibration-editor'; editor.className = 'calibration-editor'; editor.hidden = true;
  const editorHeader = make('div'); editorHeader.className = 'editor-header';
  const editorTitle = make('h2'); const editorCancel = make('button', 'Cancel'); editorCancel.type = 'button';
  const editorFlowLabel = make('label', 'Flow (ml/s)'); editorFlowLabel.className = 'field editor-flow';
  const editorFlow = make('input'); editorFlow.type = 'number'; editorFlow.min = '0.4'; editorFlow.max = '2.5'; editorFlow.step = '0.1'; editorFlowLabel.append(editorFlow);
  editorHeader.append(editorTitle, editorFlowLabel, editorCancel); editor.append(editorHeader);
  const methods = make('div'); methods.className = 'calibration-actions';
  const guidedButton = make('button', 'Guided calibration'), manualButton = make('button', 'Enter measured time');
  guidedButton.type = manualButton.type = 'button'; methods.append(guidedButton, manualButton); editor.append(methods);
  const methodHost = make('div'); editor.append(methodHost);
  const editorActions = make('div'); editorActions.className = 'calibration-actions';
  const update = make('button', 'Update saved flow'), close = make('button', 'Close without update');
  update.type = close.type = 'button'; editorActions.append(update, close); editor.append(editorActions);
  const newRow = make('div'); newRow.className = 'calibration-actions'; panel.insertBefore(newRow, manual);
  const newCalibration = make('button', 'New calibration'); newCalibration.type = 'button'; newRow.append(newCalibration);

  let readings = calibrationLibrary(settings()) || [];
  let openKey = null, draftFlow = NaN, draftTarget = NaN, guidedMode = true, locked = false;
  let guide = null, review = null, clearGuided = () => {}, measurementReady = false;

  function settings() {
    return {
      flowReadings: field('flowReadings').value,
      calibrationMode: field('calibrationMode').value,
      targetTemperatureC: Number(field('targetTemperatureC').value),
      minimumFlow: Number(field('minimumFlow').value), maximumFlow: Number(field('maximumFlow').value),
      referenceFlow: Number(field('referenceFlow').value), referenceMilkGrams: Number(field('referenceMilkGrams').value),
      referenceSeconds: Number(field('referenceSeconds').value),
    };
  }
  const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.000001;
  function activeAndOther() {
    return partitionFlowReadings({ ...settings(), flowReadings: JSON.stringify(readings) });
  }
  function defaultReading() {
    const current = settings();
    return readings.find(reading => same(reading.flow, current.referenceFlow) && same(reading.targetTemperatureC, current.targetTemperatureC));
  }
  function syncStored() {
    readings.sort((a, b) => a.targetTemperatureC - b.targetTemperatureC || a.flow - b.flow);
    field('flowReadings').value = JSON.stringify(readings);
    const selected = defaultReading();
    if (selected) {
      field('referenceMilkGrams').value = selected.milkGrams;
      field('referenceSeconds').value = selected.seconds;
    }
    updateChoices();
  }
  function setDefault(reading) {
    field('targetTemperatureC').value = reading.targetTemperatureC;
    field('referenceFlow').value = reading.flow;
    field('referenceMilkGrams').value = reading.milkGrams;
    field('referenceSeconds').value = reading.seconds;
    syncFlow(reading.flow, true); syncStored(); render();
  }
  function readingLabel(reading) {
    return reading.flow.toFixed(1) + ' ml/s · ' + reading.targetTemperatureC.toFixed(1) + ' °C · ' + reading.milkGrams + ' g · ' + reading.seconds + ' s';
  }
  function rowFor(reading, allowDefault = true) {
    const wrapper = make('div'); wrapper.className = 'saved-calibration';
    const row = make('div'); row.className = 'saved-calibration-row'; row.append(make('span', readingLabel(reading)));
    const edit = make('button', openKey === calibrationKey(reading) ? 'Cancel' : 'Edit'); edit.type = 'button';
    edit.addEventListener('click', () => openKey === calibrationKey(reading) ? cancelEditor() : openEditor(reading)); row.append(edit);
    const remove = make('button', 'Delete'); remove.type = 'button'; remove.addEventListener('click', () => {
      if (locked) return; readings = readings.filter(item => calibrationKey(item) !== calibrationKey(reading));
      if (openKey === calibrationKey(reading)) cancelEditor();
      const remaining = readings.filter(item => same(item.targetTemperatureC, field('targetTemperatureC').value));
      if (!defaultReading() && remaining.length) setDefault(remaining.sort((a, b) => a.flow - b.flow)[0]);
      else { syncStored(); render(); }
    }); row.append(remove);
    if (allowDefault) {
      const label = make('label'); label.className = 'default-choice';
      const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = calibrationKey(defaultReading() || {}) === calibrationKey(reading);
      checkbox.addEventListener('change', () => { if (checkbox.checked) setDefault(reading); }); label.append(checkbox, make('span', 'Default')); row.append(label);
    }
    wrapper.append(row);
    if (openKey === calibrationKey(reading)) wrapper.append(editor);
    return wrapper;
  }
  function missingRow(kind, flow) {
    const wrapper = make('div'); wrapper.className = 'saved-calibration missing-calibration';
    const row = make('div'); row.className = 'saved-calibration-row';
    row.append(make('span', kind + ' reading · ' + flow.toFixed(1) + ' ml/s · required'));
    const key = 'new:' + kind;
    const button = make('button', openKey === key ? 'Cancel' : 'Create reading'); button.type = 'button';
    button.addEventListener('click', () => openKey === key ? cancelEditor() : openEditor(null, flow, key)); row.append(button);
    wrapper.append(row); if (openKey === key) wrapper.append(editor); return wrapper;
  }
  function openEditor(reading, flow, key) {
    if (locked) return;
    openKey = key || calibrationKey(reading); draftFlow = Number(reading?.flow ?? flow ?? field('referenceFlow').value);
    draftTarget = Number(reading?.targetTemperatureC ?? field('targetTemperatureC').value);
    field('referenceMilkGrams').value = reading?.milkGrams || '';
    field('referenceSeconds').value = reading?.seconds || '';
    editorFlow.value = draftFlow; measurementReady = false; clearGuided(); editor.hidden = false; render();
  }
  function cancelEditor() { openKey = null; editor.hidden = true; measurementReady = false; clearGuided(); syncStored(); render(); }
  function setMethod(guidedSelected) { guidedMode = guidedSelected; paintEditor(); }
  function paintEditor() {
    if (!openKey) return;
    editorTitle.textContent = (openKey.startsWith('new:') ? 'New calibration · ' : 'Edit calibration · ') + draftFlow.toFixed(1) + ' ml/s · ' + draftTarget.toFixed(1) + ' °C';
    editorFlowLabel.hidden = !openKey.startsWith('new:'); editorFlow.disabled = locked;
    guidedButton.setAttribute('aria-pressed', String(guidedMode)); manualButton.setAttribute('aria-pressed', String(!guidedMode));
    if (guide && review) { guide.hidden = !guidedMode; review.hidden = guidedMode; review.open = true; }
    update.disabled = locked || (guidedMode && !measurementReady && !validFlowReading({ flow: draftFlow, targetTemperatureC: draftTarget, milkGrams: Number(field('referenceMilkGrams').value), seconds: Number(field('referenceSeconds').value) }));
  }
  function saveEditor() {
    const reading = { flow: draftFlow, targetTemperatureC: draftTarget, milkGrams: Number(field('referenceMilkGrams').value), seconds: Number(field('referenceSeconds').value) };
    if (!validFlowReading(reading)) { note.textContent = 'Enter 10–1500 g of milk and 1–255 seconds.'; return; }
    const oldKey = openKey.startsWith('new:') ? null : openKey;
    const duplicate = readings.find(item => calibrationKey(item) === calibrationKey(reading) && calibrationKey(item) !== oldKey);
    if (duplicate) { note.textContent = 'A calibration at this flow and target temperature already exists.'; return; }
    readings = readings.filter(item => calibrationKey(item) !== oldKey); readings.push(reading);
    if (!defaultReading() || field('calibrationMode').value === 'single' && readings.length === 1) setDefault(reading);
    openKey = null; editor.hidden = true; syncStored(); render();
  }
  function render() {
    const isMultiple = field('calibrationMode').value === 'multiple';
    single.setAttribute('aria-pressed', String(!isMultiple)); multipleButton.setAttribute('aria-pressed', String(isMultiple));
    range.hidden = !isMultiple; newCalibration.hidden = isMultiple;
    main.replaceChildren(); otherRows.replaceChildren();
    const { active, other } = activeAndOther();
    if (!isMultiple) {
      main.append(make('p', readings.length ? 'Saved calibrations' : 'No saved calibrations yet. Create the first calibration.'));
      readings.forEach(reading => main.append(rowFor(reading, true)));
      newCalibration.textContent = openKey === 'new:single' ? 'Cancel' : (readings.length ? 'New calibration' : 'Create first calibration');
      others.hidden = true;
      note.textContent = 'Single uses only the calibration checked as Default.';
    } else {
      main.append(make('p', 'Calibrations used for ' + Number(field('targetTemperatureC').value).toFixed(1) + ' °C within the selected range'));
      active.forEach((reading, index) => { main.append(rowFor(reading, true)); if (index < active.length - 1) { const arrow = make('div', '↓'); arrow.className = 'reading-arrow'; main.append(arrow); } });
      const required = multipleCalibrationRequirements({ ...settings(), flowReadings: JSON.stringify(readings) });
      const min = Number(field('minimumFlow').value), max = Number(field('maximumFlow').value);
      if (!required.hasMinimum) main.append(missingRow('Minimum', min));
      if (!required.hasInterior) main.append(missingRow('Interior', Math.round(((min + max) / 2) * 10) / 10));
      if (!required.hasMaximum) main.append(missingRow('Maximum', max));
      other.forEach(reading => otherRows.append(rowFor(reading, false)));
      others.hidden = !other.length;
      note.textContent = required.active.length >= 3 && required.hasMinimum && required.hasMaximum && required.hasInterior
        ? 'All ' + required.active.length + ' matching calibrations will be used for piecewise interpolation.'
        : 'Add the exact minimum, exact maximum, and at least one interior reading. A reading near the middle is recommended.';
    }
    if (openKey && openKey === 'new:single') newRow.append(editor); else if (!openKey) editor.hidden = true;
    paintEditor(); updateChoices();
  }
  function mode(value) {
    if (locked) return; field('calibrationMode').value = value;
    if (value === 'multiple') {
      const active = activeAndOther().active;
      if (active.length && !active.some(item => same(item.flow, field('referenceFlow').value))) setDefault(active[0]);
    }
    cancelEditor();
  }
  single.addEventListener('click', () => mode('single')); multipleButton.addEventListener('click', () => mode('multiple'));
  newCalibration.addEventListener('click', () => openKey === 'new:single' ? cancelEditor() : openEditor(null, Number(field('referenceFlow').value), 'new:single'));
  editorCancel.addEventListener('click', cancelEditor); close.addEventListener('click', cancelEditor);
  guidedButton.addEventListener('click', () => setMethod(true)); manualButton.addEventListener('click', () => setMethod(false)); update.addEventListener('click', saveEditor);
  editorFlow.addEventListener('input', () => { draftFlow = Number(editorFlow.value); measurementReady = false; clearGuided(); paintEditor(); });
  for (const input of [field('targetTemperatureC'), field('minimumFlow'), field('maximumFlow')]) input.addEventListener('change', () => { cancelEditor(); render(); });
  form.addEventListener('input', event => { if (event.target === field('referenceMilkGrams') || event.target === field('referenceSeconds')) { measurementReady = false; paintEditor(); } });
  syncStored(); render();
  return {
    currentFlow: () => draftFlow,
    currentTargetLabel: () => draftTarget.toFixed(1) + ' °C',
    attach(guided, measured, flowLabel, clear) {
      guide = guided; review = measured; clearGuided = clear;
      flowLabel.hidden = true; methodHost.append(guided, measured); paintEditor();
    },
    lock(value) { locked = value; for (const button of [single, multipleButton, newCalibration, editorCancel, close, update, guidedButton, manualButton]) button.disabled = value; paintEditor(); },
    acceptMeasurement(result) {
      if (!same(result.flow, draftFlow)) throw new Error('The measurement flow changed. Repeat this reading.');
      field('referenceMilkGrams').value = result.milkGrams; field('referenceSeconds').value = result.seconds;
      measurementReady = true; paintEditor();
    },
    flowChanged() { render(); },
    reveal() { render(); },
    assertCanSave() {
      if (openKey) throw Object.assign(new Error('Update or close the open calibration before saving.'), { field: 'flowReadings' });
      const target = Number(field('targetTemperatureC').value);
      if (!Number.isFinite(target) || target <= 0 || target > 100) throw Object.assign(new Error('Enter the required target milk temperature between 0 and 100 °C.'), { field: 'targetTemperatureC' });
      syncStored();
    },
  };
}
