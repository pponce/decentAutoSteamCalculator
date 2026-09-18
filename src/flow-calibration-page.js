function mountFlowCalibrationPage({ form, labels, field, updateChoices, syncFlow, persistLibrary }, model) {
  const { calibrationLibrary, partitionFlowReadings, interpolationRequirements, availableTargets, calibrationKey, validFlowReading,
    temperatureToC, temperatureFromC, formatTemperature } = model;
  const make = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
  const panel = labels.referenceMilkGrams.closest('fieldset').parentElement;
  const manual = labels.referenceMilkGrams.closest('fieldset');
  const config = make('fieldset'); config.className = 'flow-setup settings-section';
  const configGrid = make('div'); configGrid.className = 'calibration-config-grid full-width'; config.append(configGrid);
  labels.interpolate.className = 'interpolate-switch';
  configGrid.append(labels.interpolate, labels.weightMode, labels.temperatureUnit, labels.targetTemperatureC);
  const range = make('div'); range.className = 'field-grid full-width'; range.append(labels.minimumFlow, labels.maximumFlow); config.append(range);
  const note = make('p'); note.className = 'local-status full-width'; note.setAttribute('role', 'status'); config.append(note);
  panel.insertBefore(config, manual);

  const main = make('section'); main.id = 'active-calibrations'; main.className = 'calibration-library settings-section'; panel.insertBefore(main, manual);
  const others = make('details'); others.id = 'other-calibrations';
  const otherSummary = make('summary', 'Other saved calibrations'); others.append(otherSummary);
  const otherHelp = make('p', 'Readings outside the selected milk target or interpolation range. They remain saved until deleted.');
  otherHelp.className = 'other-calibrations-help';
  const otherRows = make('div'); others.append(otherHelp, otherRows); panel.insertBefore(others, manual);
  const editor = make('section'); editor.id = 'calibration-editor'; editor.className = 'calibration-editor'; editor.hidden = true;
  const editorHome = make('div'); editorHome.hidden = true; panel.insertBefore(editorHome, manual); editorHome.append(editor);
  const editorHeader = make('div'); editorHeader.className = 'editor-header';
  const editorHeading = make('div'); editorHeading.className = 'editor-heading';
  const editorTitleRow = make('div'); editorTitleRow.className = 'editor-title-row';
  const editorTitle = make('h3');
  const editorNavigation = make('div'); editorNavigation.className = 'reading-navigation';
  const previousReading = make('button', '↑'), nextReading = make('button', '↓');
  previousReading.type = nextReading.type = 'button';
  previousReading.setAttribute('aria-label', 'Previous reading above'); nextReading.setAttribute('aria-label', 'Next reading below');
  editorNavigation.append(previousReading, nextReading); editorTitleRow.append(editorTitle, editorNavigation);
  const editorIdentityHelp = make('span'); editorIdentityHelp.className = 'editor-identity-help';
  editorHeading.append(editorTitleRow, editorIdentityHelp);
  const methods = make('div'); methods.className = 'calibration-actions entry-methods';
  const manualButton = make('button', 'Enter measured time'), guidedButton = make('button', 'Guided calibration');
  guidedButton.type = manualButton.type = 'button'; methods.append(manualButton, guidedButton);
  editorHeader.append(editorHeading, methods); editor.append(editorHeader);
  const identityFields = make('div'); identityFields.className = 'editor-identity-fields';
  const editorFlowLabel = make('label', 'Flow (ml/s)'); editorFlowLabel.className = 'field editor-flow';
  const editorFlow = make('input'); editorFlow.type = 'number'; editorFlow.min = '0.4'; editorFlow.max = '2.5'; editorFlow.step = '0.1';
  const editorFlowHelp = make('small', 'ml/s · required'); editorFlowLabel.append(editorFlow, editorFlowHelp);
  const editorTargetLabel = make('label', 'Milk target'); editorTargetLabel.className = 'field editor-target';
  const editorTarget = make('input'); editorTarget.type = 'number'; editorTarget.step = '0.1';
  const editorTargetHelp = make('small'); editorTargetLabel.append(editorTarget, editorTargetHelp);
  identityFields.append(editorFlowLabel, editorTargetLabel); editor.append(identityFields);
  const methodHost = make('div'); editor.append(methodHost);
  const editorActions = make('div'); editorActions.className = 'calibration-actions editor-save-row';
  const update = make('button', 'Update saved calibration'), close = make('button', 'Close without update');
  update.type = close.type = 'button'; update.className = 'primary-action'; editorActions.append(close, update); editor.append(editorActions);
  const newCalibration = make('button', '+ New calibration'); newCalibration.type = 'button'; newCalibration.className = 'new-calibration';

  let displayedUnit = field('temperatureUnit').value || 'F';
  let readings = calibrationLibrary(settings()) || [];
  let openKey = null, draftFlow = NaN, draftTarget = NaN, guidedMode = false, locked = false;
  let guide = null, review = null, clearGuided = () => {}, measurementReady = false;

  function settings() {
    return {
      flowReadings: field('flowReadings').value,
      interpolate: field('interpolate').checked,
      targetTemperatureC: Number(field('targetTemperatureC').value || 0),
      minimumFlow: Number(field('minimumFlow').value), maximumFlow: Number(field('maximumFlow').value),
      referenceFlow: Number(field('referenceFlow').value), referenceMilkGrams: Number(field('referenceMilkGrams').value),
      referenceSeconds: Number(field('referenceSeconds').value),
    };
  }
  const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.000001;
  function activeAndOther() {
    return partitionFlowReadings({ ...settings(), flowReadings: JSON.stringify(readings) });
  }
  function targetList() {
    return availableTargets({ flowReadings: JSON.stringify(readings) });
  }
  function targetComplete(target) {
    const required = interpolationRequirements({ ...settings(), interpolate: true, targetTemperatureC: target, flowReadings: JSON.stringify(readings) });
    return required.active.length >= 3 && required.hasMinimum && required.hasMaximum && required.hasInterior;
  }
  function refreshTargetChoices() {
    const select = field('targetTemperatureC');
    const targets = targetList();
    const current = Number(select.value || 0);
    let chosen;
    if (field('interpolate').checked) {
      chosen = targets.some(target => same(target, current)) ? current : (targets[0] ?? 0);
      const options = targets.map(target => {
        const option = make('option', formatTemperature(target, displayedUnit) + (targetComplete(target) ? '' : ' · incomplete'));
        option.value = target; return option;
      });
      if (!options.length) { const option = make('option', 'No saved targets'); option.value = ''; options.push(option); }
      select.replaceChildren(...options);
    } else {
      chosen = current === 0 || targets.some(target => same(target, current)) ? current : 0;
      const all = make('option', 'All targets'); all.value = 0;
      const options = targets.map(target => { const option = make('option', formatTemperature(target, displayedUnit)); option.value = target; return option; });
      select.replaceChildren(all, ...options);
    }
    select.value = field('interpolate').checked && chosen === 0 ? '' : String(chosen);
  }
  function navigationTargets() {
    if (!field('interpolate').checked) return [];
    const { active } = activeAndOther();
    const required = interpolationRequirements({ ...settings(), flowReadings: JSON.stringify(readings) });
    const targets = active.map(reading => ({ key: calibrationKey(reading), flow: reading.flow, reading }));
    const min = Number(field('minimumFlow').value), max = Number(field('maximumFlow').value);
    if (!required.hasMinimum) targets.push({ key: 'new:Minimum', flow: min });
    if (!required.hasInterior) targets.push({ key: 'new:Interior', flow: Math.round(((min + max) / 2) * 10) / 10 });
    if (!required.hasMaximum) targets.push({ key: 'new:Maximum', flow: max });
    return targets.sort((a, b) => a.flow - b.flow);
  }
  function syncStored() {
    readings.sort((a, b) => a.targetTemperatureC - b.targetTemperatureC || a.flow - b.flow);
    field('flowReadings').value = JSON.stringify(readings);
    updateChoices();
  }
  async function persistStored(successMessage) {
    try {
      await persistLibrary(field('flowReadings').value);
      note.textContent = successMessage;
    } catch (error) {
      note.textContent = error.message;
      throw error;
    }
  }
  function readingDetails(reading) {
    const details = make('div'); details.className = 'saved-calibration-details';
    const flow = make('span', reading.flow.toFixed(1) + ' ml/s'); flow.className = 'saved-calibration-flow';
    const meta = make('span', formatTemperature(reading.targetTemperatureC, displayedUnit) + ' · ' + reading.milkGrams + ' g milk · ' + reading.seconds + ' s'); meta.className = 'saved-calibration-meta';
    details.append(flow, meta); return details;
  }
  function rowFor(reading) {
    const wrapper = make('div'); wrapper.className = 'saved-calibration';
    const row = make('div'); row.className = 'saved-calibration-row'; row.append(readingDetails(reading));
    const edit = make('button', openKey === calibrationKey(reading) ? 'Cancel' : 'Edit'); edit.type = 'button';
    edit.addEventListener('click', () => openKey === calibrationKey(reading) ? cancelEditor() : openEditor(reading)); row.append(edit);
    const remove = make('button', 'Delete'); remove.type = 'button'; remove.addEventListener('click', async () => {
      if (locked) return;
      const before = readings;
      readings = readings.filter(item => calibrationKey(item) !== calibrationKey(reading));
      if (openKey === calibrationKey(reading)) cancelEditor();
      refreshTargetChoices(); syncStored(); render();
      try { await persistStored('Calibration deleted.'); } catch { readings = before; refreshTargetChoices(); syncStored(); render(); }
    }); row.append(remove);
    wrapper.append(row);
    if (openKey === calibrationKey(reading)) wrapper.append(editor);
    return wrapper;
  }
  function missingRow(kind, flow) {
    const wrapper = make('div'); wrapper.className = 'saved-calibration missing-calibration';
    const row = make('div'); row.className = 'saved-calibration-row';
    const details = make('div'); details.className = 'saved-calibration-details';
    const title = make('span', kind + ' reading · ' + flow.toFixed(1) + ' ml/s'); title.className = 'saved-calibration-flow';
    const meta = make('span', formatTemperature(settings().targetTemperatureC, displayedUnit) + ' · required'); meta.className = 'saved-calibration-meta';
    details.append(title, meta); row.append(details);
    const key = 'new:' + kind;
    const button = make('button', openKey === key ? 'Cancel' : 'Create reading'); button.type = 'button';
    button.addEventListener('click', () => openKey === key ? cancelEditor() : openEditor(null, flow, key)); row.append(button);
    wrapper.append(row); if (openKey === key) wrapper.append(editor); return wrapper;
  }
  function openEditor(reading, flow, key) {
    if (locked) return;
    const selectedTarget = Number(field('targetTemperatureC').value || 0);
    openKey = key || calibrationKey(reading); draftFlow = Number(reading?.flow ?? flow ?? field('referenceFlow').value);
    draftTarget = Number(reading?.targetTemperatureC ?? (selectedTarget || targetList()[0] || 60));
    field('referenceFlow').value = draftFlow;
    field('referenceMilkGrams').value = reading?.milkGrams || '';
    field('referenceSeconds').value = reading?.seconds || '';
    editorFlow.value = draftFlow; editorTarget.value = temperatureFromC(draftTarget, displayedUnit);
    measurementReady = false; clearGuided(); editor.hidden = false; render();
  }
  function cancelEditor() { openKey = null; editor.hidden = true; measurementReady = false; clearGuided(); syncStored(); render(); }
  function setMethod(guidedSelected) { guidedMode = guidedSelected; paintEditor(); }
  function navigateEditor(direction) {
    const targets = navigationTargets(), index = targets.findIndex(target => target.key === openKey);
    const target = targets[index + direction]; if (!target) return;
    openEditor(target.reading || null, target.flow, target.key);
  }
  function paintEditor() {
    if (!openKey) return;
    const targets = navigationTargets(), readingIndex = targets.findIndex(target => target.key === openKey);
    const navigable = field('interpolate').checked && readingIndex >= 0;
    const interior = openKey === 'new:Interior';
    if (openKey === 'new:saved') editorTitle.textContent = 'New saved calibration';
    else if (interior) editorTitle.textContent = '';
    else if (navigable) editorTitle.textContent = 'Reading ' + (readingIndex + 1) + ' of ' + targets.length + ' · ' + draftFlow.toFixed(1) + ' ml/s · ' + formatTemperature(draftTarget, displayedUnit);
    else editorTitle.textContent = 'Editing ' + draftFlow.toFixed(1) + ' ml/s · ' + formatTemperature(draftTarget, displayedUnit);
    editorIdentityHelp.textContent = interior
      ? 'Target ' + formatTemperature(draftTarget, displayedUnit) + ' · midpoint suggested; choose any interior flow.'
      : 'Flow and milk target uniquely identify this calibration.';
    editorNavigation.hidden = !navigable;
    previousReading.disabled = locked || readingIndex <= 0; nextReading.disabled = locked || readingIndex < 0 || readingIndex >= targets.length - 1;
    const editableFlow = openKey === 'new:saved' || interior;
    editorTitle.hidden = interior;
    if (interior) editorTitleRow.insertBefore(editorFlowLabel, editorNavigation);
    else identityFields.insertBefore(editorFlowLabel, editorTargetLabel);
    editorFlowLabel.className = interior ? 'field editor-flow inline-editor-flow' : 'field editor-flow';
    editorFlowHelp.textContent = interior ? 'ml/s · ' + field('minimumFlow').value + '–' + field('maximumFlow').value : 'ml/s · required';
    editorFlowLabel.hidden = !editableFlow; editorTargetLabel.hidden = !editableFlow; identityFields.hidden = !editableFlow;
    editorFlow.disabled = locked; editorTarget.disabled = locked;
    editorTarget.min = displayedUnit === 'F' ? '32.2' : '0.1'; editorTarget.max = displayedUnit === 'F' ? '212' : '100';
    editorTargetHelp.textContent = '°' + displayedUnit + ' · required';
    guidedButton.setAttribute('aria-pressed', String(guidedMode)); manualButton.setAttribute('aria-pressed', String(!guidedMode));
    if (guide && review) { guide.hidden = !guidedMode; review.hidden = guidedMode; }
    update.disabled = locked || (guidedMode && !measurementReady && !validFlowReading({ flow: draftFlow, targetTemperatureC: draftTarget, milkGrams: Number(field('referenceMilkGrams').value), seconds: Number(field('referenceSeconds').value) }));
    update.textContent = openKey.startsWith('new:') ? 'Create saved calibration' : 'Update saved calibration';
  }
  async function saveEditor() {
    const reading = { flow: draftFlow, targetTemperatureC: draftTarget, milkGrams: Number(field('referenceMilkGrams').value), seconds: Number(field('referenceSeconds').value) };
    if (!validFlowReading(reading)) { note.textContent = 'Enter a flow, milk target, 10–1500 g of milk and 1–255 seconds.'; return; }
    const oldKey = openKey.startsWith('new:') ? null : openKey;
    const duplicate = readings.find(item => calibrationKey(item) === calibrationKey(reading) && calibrationKey(item) !== oldKey);
    if (duplicate) { note.textContent = 'A calibration at this flow and milk target already exists.'; return; }
    const before = readings;
    readings = readings.filter(item => calibrationKey(item) !== oldKey); readings.push(reading);
    if (field('interpolate').checked) field('targetTemperatureC').value = reading.targetTemperatureC;
    openKey = null; editor.hidden = true; refreshTargetChoices(); syncStored(); render();
    try { await persistStored('Calibration saved.'); }
    catch { readings = before; refreshTargetChoices(); syncStored(); render(); }
  }
  function libraryHeader(title, valid) {
    const header = make('div'); header.className = 'calibration-library-header';
    const heading = make('div'); heading.append(make('h3', title));
    const actions = make('div'); actions.className = 'calibration-library-actions';
    const validation = make('span', valid ? 'Ready to save' : 'More readings needed'); validation.className = 'calibration-validation' + (valid ? '' : ' invalid');
    actions.append(validation, newCalibration); header.append(heading, actions); return header;
  }
  function render() {
    if (!openKey) { editor.hidden = true; editorHome.append(editor); }
    const interpolate = field('interpolate').checked;
    range.hidden = !interpolate; newCalibration.hidden = interpolate;
    main.replaceChildren(); otherRows.replaceChildren();
    const { active, other } = activeAndOther();
    if (!interpolate) {
      main.append(libraryHeader('Available calibrations (' + active.length + ')', active.length > 0));
      if (!active.length) { const empty = make('p', 'No saved calibrations match this milk target. Create the first calibration or choose All targets.'); empty.className = 'empty-calibrations'; main.append(empty); }
      active.forEach(reading => main.append(rowFor(reading)));
      newCalibration.textContent = openKey === 'new:saved' ? 'Cancel' : (readings.length ? '+ New calibration' : 'Create first calibration');
      if (openKey === 'new:saved') {
        const wrapper = make('div'); wrapper.className = 'saved-calibration new-calibration-editor';
        const row = make('div'); row.className = 'saved-calibration-row editing';
        const details = make('div'); details.className = 'saved-calibration-details';
        const title = make('span', 'New calibration'); title.className = 'saved-calibration-flow';
        const meta = make('span', 'Milk target ' + formatTemperature(draftTarget, displayedUnit)); meta.className = 'saved-calibration-meta';
        details.append(title, meta); row.append(details); wrapper.append(row, editor); main.append(wrapper);
      }
      note.textContent = active.length > 1
        ? 'The shot page will cycle through these saved calibrations.'
        : 'Create one calibration to get started.';
    } else {
      const required = interpolationRequirements({ ...settings(), flowReadings: JSON.stringify(readings) });
      const complete = required.active.length >= 3 && required.hasMinimum && required.hasMaximum && required.hasInterior;
      main.append(libraryHeader('Interpolation readings (' + active.length + ')', complete));
      for (const target of navigationTargets()) {
        if (target.reading) main.append(rowFor(target.reading));
        else main.append(missingRow(target.key.slice(4), target.flow));
      }
      note.textContent = complete
        ? 'All ' + required.active.length + ' matching calibrations will be used for piecewise interpolation.'
        : 'Add the exact minimum, exact maximum, and at least one interior reading.';
    }
    other.forEach(reading => otherRows.append(rowFor(reading)));
    otherSummary.textContent = 'Other saved calibrations (' + other.length + ')';
    others.hidden = !other.length;
    paintEditor(); updateChoices();
  }
  function interpolationChanged() {
    if (locked) return;
    field('targetTemperatureC').value = field('interpolate').checked ? '' : '0';
    refreshTargetChoices();
    cancelEditor();
  }
  field('interpolate').addEventListener('change', interpolationChanged);
  newCalibration.addEventListener('click', () => openKey === 'new:saved' ? cancelEditor() : openEditor(null, Number(field('referenceFlow').value), 'new:saved'));
  close.addEventListener('click', cancelEditor); previousReading.addEventListener('click', () => navigateEditor(-1)); nextReading.addEventListener('click', () => navigateEditor(1));
  guidedButton.addEventListener('click', () => setMethod(true)); manualButton.addEventListener('click', () => setMethod(false)); update.addEventListener('click', saveEditor);
  editorFlow.addEventListener('input', () => { draftFlow = Number(editorFlow.value); field('referenceFlow').value = draftFlow; measurementReady = false; clearGuided(); paintEditor(); });
  editorTarget.addEventListener('input', () => { draftTarget = temperatureToC(editorTarget.value, displayedUnit); measurementReady = false; clearGuided(); paintEditor(); });
  function applyTemperaturePresentation() {
    labels.targetTemperatureC.children[0].textContent = 'Milk target';
    refreshTargetChoices();
    if (openKey) editorTarget.value = temperatureFromC(draftTarget, displayedUnit);
  }
  field('temperatureUnit').addEventListener('change', () => {
    displayedUnit = field('temperatureUnit').value || 'F';
    applyTemperaturePresentation(); render();
  });
  for (const input of [field('targetTemperatureC'), field('minimumFlow'), field('maximumFlow')]) input.addEventListener('change', () => { cancelEditor(); render(); });
  form.addEventListener('input', event => { if (event.target === field('referenceMilkGrams') || event.target === field('referenceSeconds')) { measurementReady = false; paintEditor(); } });
  applyTemperaturePresentation(); syncStored(); render();
  return {
    currentFlow: () => draftFlow,
    currentTargetLabel: () => formatTemperature(draftTarget, displayedUnit),
    attach(guided, measured, flowLabel, clear) {
      guide = guided; review = measured; clearGuided = clear;
      flowLabel.hidden = true; methodHost.append(guided, measured); paintEditor();
    },
    lock(value) { locked = value; for (const button of [newCalibration, close, update, guidedButton, manualButton, previousReading, nextReading]) button.disabled = value; field('interpolate').disabled = value; paintEditor(); },
    acceptMeasurement(result) {
      if (!same(result.flow, draftFlow)) throw new Error('The measurement flow changed. Repeat this reading.');
      field('referenceMilkGrams').value = result.milkGrams; field('referenceSeconds').value = result.seconds;
      measurementReady = true; paintEditor();
    },
    flowChanged() { render(); },
    reveal() { render(); },
    assertCanSave() {
      if (openKey) throw Object.assign(new Error('Update or close the open calibration before saving.'), { field: 'flowReadings' });
      syncStored();
    },
  };
}
