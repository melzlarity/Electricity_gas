
        const DEFAULT_CONFIG = {
            electricity: { basePrice: 10.44, workPrice: 0.3315, monthlyAbschlag: 121.00 },
            gas: { basePrice: 17.80, workPrice: 0.1004, conversionFactor: 10.7, monthlyAbschlag: 304.00 },
            water: { basePrice: 8.00, workPrice: 2.15, monthlyAbschlag: 78.00 }
        };

        const UTILITY_META = {
            electricity: { name: 'Strom', unit: 'kWh', inputUnit: 'kWh', icon: 'lightning-charge-fill', color: '#f5a623' },
            gas: { name: 'Gas', unit: 'kWh', inputUnit: 'mÂ³', icon: 'fire', color: '#df6d51' },
            water: { name: 'Wasser', unit: 'mÂ³', inputUnit: 'mÂ³', icon: 'droplet-fill', color: '#2d89d0' }
        };

        let configs = loadConfigs();
        let data = loadData();
        let charts = {};
        let editing = null;

        function loadConfigs() {
            try {
                const saved = JSON.parse(localStorage.getItem('utilityConfigs'));
                return saved ? mergeConfigs(saved) : structuredClone(DEFAULT_CONFIG);
            } catch (_) {
                return structuredClone(DEFAULT_CONFIG);
            }
        }

        function mergeConfigs(saved) {
            const merged = structuredClone(DEFAULT_CONFIG);
            Object.keys(merged).forEach(key => {
                merged[key] = { ...merged[key], ...(saved[key] || {}) };
            });
            return merged;
        }

        function loadData() {
            try {
                const saved = JSON.parse(localStorage.getItem('utilityData'));
                if (saved && typeof saved === 'object') {
                    return normalizeStore(saved);
                }
            } catch (_) {}
            return { electricity: [], gas: [], water: [] };
        }

        function normalizeStore(store) {
            const normalized = { electricity: [], gas: [], water: [] };
            Object.keys(normalized).forEach(key => {
                normalized[key] = (Array.isArray(store[key]) ? store[key] : []).map((item, index) => ({
                    id: item.id || `${key}-${Date.now()}-${index}`,
                    date: item.date ? String(item.date).slice(0, 10) : '',
                    reading: Number(item.reading)
                })).filter(item => item.date && Number.isFinite(item.reading));
                normalized[key].sort((a, b) => a.date.localeCompare(b.date));
            });
            return normalized;
        }

        function saveData() {
            localStorage.setItem('utilityData', JSON.stringify(data));
            localStorage.setItem('utilityConfigs', JSON.stringify(configs));
        }

        function showToast(message) {
            document.getElementById('toast-message').textContent = message;
            bootstrap.Toast.getOrCreateInstance(document.getElementById('app-toast'), { delay: 2500 }).show();
        }

        function formatNumber(value, decimals = 2) {
            return Number(value || 0).toLocaleString('de-DE', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            });
        }

        function parseLocalDate(dateString) {
            const [year, month, day] = dateString.split('-').map(Number);
            return new Date(year, month - 1, day);
        }

        function formatDate(dateString) {
            if (!dateString) return 'â€”';
            return parseLocalDate(dateString).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }

        function escapeHtml(value) {
            return String(value).replace(/[&<>"']/g, character => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
            }[character]));
        }

        function calculateRecord(record, previous) {
            if (!previous) return { consumption: 0, elapsedDays: 0 };
            const elapsedDays = Math.max(1, Math.round((parseLocalDate(record.date) - parseLocalDate(previous.date)) / 86400000));
            return {
                consumption: Math.max(0, record.reading - previous.reading),
                elapsedDays
            };
        }

        function getUsageUnitConsumption(key, readingDiff) {
            if (key === 'gas') return readingDiff * configs.gas.conversionFactor;
            return readingDiff;
        }

        function getPeriodCost(key, consumption, elapsedDays) {
            if (elapsedDays <= 0) return 0;
            const usageCost = key === 'gas'
                ? consumption * configs.gas.conversionFactor * configs.gas.workPrice
                : consumption * configs[key].workPrice;
            const baseCost = configs[key].basePrice * (elapsedDays / 365);
            return usageCost + baseCost;
        }

        function getPreparedRecords(key) {
            const sorted = [...data[key]].sort((a, b) => a.date.localeCompare(b.date));
            return sorted.map((record, index) => {
                const previous = index ? sorted[index - 1] : null;
                const period = calculateRecord(record, previous);
                const cost = getPeriodCost(key, period.consumption, period.elapsedDays);
                return { ...record, ...period, cost };
            });
        }

        function getDashboardSummary(key) {
            const records = getPreparedRecords(key);
            if (!records.length) return null;
            const latest = records[records.length - 1];
            const previous = records.length > 1 ? records[records.length - 2] : null;
            const latestConsumption = latest.consumption;
            const latestUsage = getUsageUnitConsumption(key, latestConsumption);
            const latestDate = parseLocalDate(latest.date);
            const monthFactor = latest.elapsedDays ? 30.4375 / latest.elapsedDays : 0;
            const monthlyProjection = latestUsage * monthFactor;
            const annualProjection = monthlyProjection * 12;

            const year = latestDate.getFullYear();
            const ytdConsumption = records
                .filter(record => parseLocalDate(record.date).getFullYear() === year)
                .reduce((sum, record) => sum + getUsageUnitConsumption(key, record.consumption), 0);
            const yearStart = new Date(year, 0, 1);
            const elapsedFraction = Math.max(1 / 365, Math.min(1, (latestDate - yearStart) / 31536000000));
            const ytdProjection = ytdConsumption / elapsedFraction;

            const periodCost = latest.cost;
            const monthlyCostProjection = periodCost * monthFactor;
            const difference = previous ? latestUsage - getUsageUnitConsumption(key, previous.consumption) : null;
            const monthlyBalance = (configs[key].monthlyAbschlag || 0) - monthlyCostProjection;

            return {
                latest, previous, latestUsage, monthlyProjection, annualProjection,
                ytdConsumption, ytdProjection, monthlyCostProjection, difference, monthlyBalance
            };
        }

        function renderDashboard() {
            const container = document.getElementById('dashboard-content');
            container.innerHTML = '';
            Object.keys(UTILITY_META).forEach((key, utilityIndex) => {
                const meta = UTILITY_META[key];
                const summary = getDashboardSummary(key);
                const records = getPreparedRecords(key);
                const cardId = `dashboard-${key}-${utilityIndex}`;
                const card = document.createElement('div');
                card.className = 'card utility-card mb-4';
                card.innerHTML = `
                    <div class="accordion accordion-flush" id="accordion-${key}">
                        <div class="accordion-item">
                            <h2 class="accordion-header">
                                <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#${cardId}">
                                    <i class="bi bi-${meta.icon} me-2" style="color:${meta.color}"></i>${meta.name}
                                </button>
                            </h2>
                            <div id="${cardId}" class="accordion-collapse collapse show">
                                <div class="accordion-body">
                                    ${summary ? renderDashboardBody(key, summary, records) : `
                                        <div class="empty-state">
                                            <i class="bi bi-clipboard-data fs-3 d-block mb-2"></i>
                                            Noch keine Messwerte fÃ¼r ${meta.name}.<br>
                                            <button class="btn btn-sm btn-primary mt-3" onclick="openInputTab()">Messwert erfassen</button>
                                        </div>`}
                                </div>
                            </div>
                        </div>
                    </div>`;
                container.appendChild(card);
            });
            requestAnimationFrame(() => {
                Object.keys(UTILITY_META).forEach(key => {
                    if (getDashboardSummary(key)) renderChart(key);
                });
            });
        }

        function renderDashboardBody(key, summary, records) {
            const meta = UTILITY_META[key];
            const balanceText = summary.monthlyBalance >= 0 ? 'Voraussichtlicher Vorteil' : 'Voraussichtlicher Mehrbedarf';
            const balanceClass = summary.monthlyBalance >= 0 ? 'text-success' : 'text-danger';
            const trend = summary.difference === null
                ? 'Erster erfasster Zeitraum'
                : `${summary.difference >= 0 ? '+' : ''}${formatNumber(summary.difference)} ${meta.unit} gegenÃ¼ber dem vorherigen Zeitraum`;

            return `
                <div class="row g-3 mb-4">
                    <div class="col-6 col-lg-3"><div class="metric-card">
                        <div class="metric-label">Letzte Verbrauchsperiode</div>
                        <div class="metric-value">${formatNumber(summary.latestUsage)} ${meta.unit}</div>
                        <small class="text-secondary">${formatDate(summary.latest.date)}</small>
                    </div></div>
                    <div class="col-6 col-lg-3"><div class="metric-card">
                        <div class="metric-label">Prognostizierte Kosten</div>
                        <div class="metric-value">${formatNumber(summary.monthlyCostProjection)} â‚¬ / Monat</div>
                        <small class="text-secondary">${formatNumber(summary.latest.cost)} â‚¬ im Zeitraum</small>
                    </div></div>
                    <div class="col-6 col-lg-3"><div class="metric-card">
                        <div class="metric-label">Monatlicher Abschlag</div>
                        <div class="metric-value">${formatNumber(configs[key].monthlyAbschlag)} â‚¬</div>
                        <small class="${balanceClass}">${balanceText}: ${formatNumber(Math.abs(summary.monthlyBalance))} â‚¬</small>
                    </div></div>
                    <div class="col-6 col-lg-3"><div class="metric-card">
                        <div class="metric-label">Jahresprojektion</div>
                        <div class="metric-value">${formatNumber(summary.ytdProjection)} ${meta.unit}</div>
                        <small class="text-secondary">${trend}</small>
                    </div></div>
                </div>
                <div class="row g-4">
                    <div class="col-lg-8">
                        <h6 class="mb-3">Verbrauchsverlauf</h6>
                        <div class="chart-wrap"><canvas id="chart-${key}"></canvas></div>
                    </div>
                    <div class="col-lg-4">
                        <h6 class="mb-3">Aktuelle Kennzahlen</h6>
                        <div class="mb-3">
                            <div class="d-flex justify-content-between small"><span>Laufzeit bis Jahresende</span><strong>${formatNumber(summary.ytdConsumption)} ${meta.unit} YTD</strong></div>
                            <div class="progress mt-2"><div class="progress-bar" style="width:${Math.min(100, summary.ytdProjection ? summary.ytdConsumption / summary.ytdProjection * 100 : 0)}%;background:${meta.color}"></div></div>
                        </div>
                        <dl class="row small mb-0">
                            <dt class="col-7">Prognose / Monat</dt><dd class="col-5 text-end">${formatNumber(summary.monthlyProjection)} ${meta.unit}</dd>
                            <dt class="col-7">Prognose / Jahr</dt><dd class="col-5 text-end">${formatNumber(summary.annualProjection)} ${meta.unit}</dd>
                            <dt class="col-7">Letzter ZÃ¤hlerstand</dt><dd class="col-5 text-end">${formatNumber(summary.latest.reading)} ${key === 'electricity' || key === 'gas' ? 'mÂ³/kWh-Einheit' : 'mÂ³'}</dd>
                            <dt class="col-7">Zeitraum</dt><dd class="col-5 text-end">${summary.latest.elapsedDays} Tage</dd>
                        </dl>
                    </div>
                </div>`;
        }

        function renderChart(key) {
            const canvas = document.getElementById(`chart-${key}`);
            if (!canvas) return;
            if (charts[key]) charts[key].destroy();
            const records = getPreparedRecords(key).filter(record => record.elapsedDays > 0);
            const meta = UTILITY_META[key];
            charts[key] = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: records.map(record => formatDate(record.date)),
                    datasets: [{
                        label: `Verbrauch (${meta.unit})`,
                        data: records.map(record => getUsageUnitConsumption(key, record.consumption)),
                        backgroundColor: `${meta.color}CC`,
                        borderColor: meta.color,
                        borderWidth: 1,
                        borderRadius: 7,
                        maxBarThickness: 48
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { intersect: false, mode: 'index' },
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: context => ` ${formatNumber(context.parsed.y)} ${meta.unit}` } }
                    },
                    scales: {
                        x: { grid: { display: false } },
                        y: { beginAtZero: true, grid: { color: '#edf1f5' }, ticks: { callback: value => `${value} ${meta.unit}` } }
                    }
                }
            });
        }

        function renderInput() {
            const container = document.getElementById('input-content');
            container.innerHTML = '';
            Object.keys(UTILITY_META).forEach(key => {
                const meta = UTILITY_META[key];
                const records = getPreparedRecords(key);
                const isEditing = editing && editing.key === key;
                const card = document.createElement('div');
                card.className = 'card utility-card mb-4';
                card.innerHTML = `
                    <div class="card-body">
                        <div class="d-flex align-items-center justify-content-between mb-3">
                            <h5 class="mb-0"><i class="bi bi-${meta.icon} me-2" style="color:${meta.color}"></i>${meta.name}</h5>
                            ${isEditing ? '<span class="badge bg-warning text-dark">Bearbeitung aktiv</span>' : ''}
                        </div>
                        <form id="form-${key}" class="row g-3 align-items-end mb-4">
                            <div class="col-md-4">
                                <label class="form-label" for="${key}-date">Ablesedatum</label>
                                <input id="${key}-date" type="date" class="form-control" required value="${isEditing ? escapeHtml(editing.date) : new Date().toISOString().slice(0, 10)}">
                            </div>
                            <div class="col-md-4">
                                <label class="form-label" for="${key}-reading">ZÃ¤hlerstand (${meta.inputUnit})</label>
                                <input id="${key}-reading" type="number" step="0.01" class="form-control" required placeholder="z. B. 12345" value="${isEditing ? escapeHtml(editing.reading) : ''}">
                            </div>
                            <div class="col-md-4 d-flex gap-2">
                                <button type="submit" class="btn btn-primary"><i class="bi bi-check-lg me-1"></i>${isEditing ? 'Ã„nderung speichern' : 'Speichern'}</button>
                                ${isEditing ? `<button type="button" class="btn btn-outline-secondary" onclick="cancelEdit()">Abbrechen</button>` : ''}
                            </div>
                        </form>
                        ${records.length ? `
                            <div class="table-responsive">
                                <table class="table align-middle mb-0">
                                    <thead class="table-light"><tr>
                                        <th>Datum</th><th>ZÃ¤hlerstand</th><th>Verbrauch</th><th>GeschÃ¤tzte Kosten</th><th class="text-end no-print">Aktionen</th>
                                    </tr></thead>
                                    <tbody>${[...records].reverse().map(record => `
                                        <tr>
                                            <td>${formatDate(record.date)}</td>
                                            <td>${formatNumber(record.reading)} ${meta.inputUnit}</td>
                                            <td>${record.elapsedDays ? `${formatNumber(key === 'gas' ? record.consumption * configs.gas.conversionFactor : record.consumption)} ${meta.unit}` : 'â€”'}</td>
                                            <td>${record.elapsedDays ? `${formatNumber(record.cost)} â‚¬` : 'â€”'}</td>
                                            <td class="text-end no-print">
                                                <button class="btn btn-sm btn-outline-secondary me-1" title="Bearbeiten" onclick="editReading('${key}','${escapeHtml(record.id)}')"><i class="bi bi-pencil"></i></button>
                                                <button class="btn btn-sm btn-outline-danger" title="LÃ¶schen" onclick="deleteReading('${key}','${escapeHtml(record.id)}')"><i class="bi bi-trash"></i></button>
                                            </td>
                                        </tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>` : '<div class="empty-state">Noch keine Messwerte vorhanden.</div>'}
                    </div>`;
                container.appendChild(card);
                document.getElementById(`form-${key}`).addEventListener('submit', event => saveReading(event, key));
            });
        }

        function openInputTab() {
            bootstrap.Tab.getOrCreateInstance(document.querySelector('[data-bs-target="#input"]')).show();
        }

        function saveReading(event, key) {
            event.preventDefault();
            const date = document.getElementById(`${key}-date`).value;
            const reading = Number(document.getElementById(`${key}-reading`).value);
            if (!date || !Number.isFinite(reading) || reading < 0) {
                showToast('Bitte ein gÃ¼ltiges Datum und einen ZÃ¤hlerstand eingeben.');
                return;
            }

            if (editing && editing.key === key) {
                const record = data[key].find(item => item.id === editing.id);
                if (record) Object.assign(record, { date, reading });
                editing = null;
                showToast('Messwert geÃ¤ndert.');
            } else {
                data[key].push({ id: `${key}-${Date.now()}-${Math.random().toString(36).slice(2)}`, date, reading });
                showToast('Messwert gespeichert.');
            }

            data[key].sort((a, b) => a.date.localeCompare(b.date));
            const invalid = data[key].some((record, index, records) => index > 0 && record.reading < records[index - 1].reading);
            if (invalid) {
                showToast('Hinweis: Ein ZÃ¤hlerstand liegt unter dem vorherigen Wert.');
            }
            saveData();
            renderInput();
            renderDashboard();
        }

        function editReading(key, id) {
            const record = data[key].find(item => item.id === id);
            if (!record) return;
            editing = { key, id, date: record.date, reading: record.reading };
            openInputTab();
            renderInput();
            document.getElementById(`${key}-reading`).focus();
        }

        function cancelEdit() {
            editing = null;
            renderInput();
        }

        function deleteReading(key, id) {
            if (!confirm('Diesen Messwert wirklich lÃ¶schen?')) return;
            data[key] = data[key].filter(record => record.id !== id);
            if (editing && editing.id === id) editing = null;
            saveData();
            renderInput();
            renderDashboard();
            showToast('Messwert gelÃ¶scht.');
        }

        function renderConfig() {
            const fields = [
                ['basePrice', 'Grundpreis (â‚¬/Monat)', '0.01'],
                ['workPrice', 'Arbeitspreis', '0.0001'],
                ['monthlyAbschlag', 'Monatlicher Abschlag (â‚¬)', '0.01']
            ];
            const container = document.getElementById('config-content');
            container.innerHTML = Object.keys(UTILITY_META).map(key => {
                const meta = UTILITY_META[key];
                const keyFields = key === 'gas'
                    ? [...fields, ['conversionFactor', 'Umrechnungsfaktor (kWh/mÂ³)', '0.01']]
                    : fields;
                return `
                    <div class="card utility-card mb-4">
                        <div class="card-body">
                            <h5 class="mb-4"><i class="bi bi-${meta.icon} me-2" style="color:${meta.color}"></i>${meta.name}</h5>
                            <div class="row g-3">
                                ${keyFields.map(([field, label, step]) => {
                                    let suffix = '';
                                    if (field === 'workPrice') suffix = key === 'electricity' ? 'â‚¬/kWh' : key === 'gas' ? 'â‚¬/kWh' : 'â‚¬/mÂ³';
                                    if (field === 'conversionFactor') suffix = 'kWh/mÂ³';
                                    return `<div class="col-md-6 col-lg-3">
                                        <label class="form-label" for="${key}-${field}">${label}</label>
                                        <div class="input-group config-input">
                                            <input id="${key}-${field}" type="number" step="${step}" class="form-control" value="${configs[key][field] ?? ''}">
                                            ${suffix ? `<span class="input-group-text">${suffix}</span>` : ''}
                                        </div>
                                    </div>`;
                                }).join('')}
                            </div>
                        </div>
                    </div>`;
            }).join('') + `
                <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center">
                    <button class="btn btn-primary" onclick="saveConfig()"><i class="bi bi-check-lg me-1"></i>Tarife speichern</button>
                    <button class="btn btn-outline-danger" onclick="clearAllData()"><i class="bi bi-trash me-1"></i>Alle Messwerte lÃ¶schen</button>
                </div>`;
        }

        function saveConfig() {
            Object.keys(UTILITY_META).forEach(key => {
                Object.keys(configs[key]).forEach(field => {
                    const input = document.getElementById(`${key}-${field}`);
                    if (input) {
                        const value = Number(input.value);
                        if (Number.isFinite(value) && value >= 0) configs[key][field] = value;
                    }
                });
            });
            saveData();
            renderConfig();
            renderDashboard();
            showToast('Konfiguration gespeichert.');
        }

        function clearAllData() {
            if (!confirm('Alle Messwerte fÃ¼r Strom, Gas und Wasser wirklich lÃ¶schen?')) return;
            if (!confirm('Letzte BestÃ¤tigung: Diese Aktion kann nicht rÃ¼ckgÃ¤ngig gemacht werden.')) return;
            data = { electricity: [], gas: [], water: [] };
            editing = null;
            saveData();
            renderInput();
            renderDashboard();
            renderConfig();
            showToast('Alle Messwerte gelÃ¶scht.');
        }

        function exportData() {
            const payload = {
                app: 'Utility Tracker EichstÃ¤tt',
                version: '1.1.0',
                exportedAt: new Date().toISOString(),
                configs,
                data
            };
            downloadFile(JSON.stringify(payload, null, 2), 'utility-data.json', 'application/json');
        }

        function exportCSV() {
            const rows = [['utility', 'date', 'meter_reading', 'unit']];
            Object.keys(UTILITY_META).forEach(key => {
                data[key].slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(record => {
                    rows.push([UTILITY_META[key].name, record.date, record.reading, UTILITY_META[key].inputUnit]);
                });
            });
            const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(';')).join('\r\n');
            downloadFile(csv, 'utility-data.csv', 'text/csv;charset=utf-8');
        }

        function downloadFile(content, filename, type) {
            const url = URL.createObjectURL(new Blob([content], { type }));
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        }

        document.getElementById('import-file').addEventListener('change', event => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const payload = JSON.parse(reader.result);
                    const importedData = payload.data || payload;
                    const importedStore = normalizeStore(importedData);
                    Object.keys(importedStore).forEach(key => {
                        const existingIds = new Set(data[key].map(record => record.id));
                        importedStore[key].forEach(record => {
                            if (!existingIds.has(record.id)) {
                                data[key].push(record);
                                existingIds.add(record.id);
                            }
                        });
                        data[key].sort((a, b) => a.date.localeCompare(b.date));
                    });
                    if (payload.configs) configs = mergeConfigs(payload.configs);
                    saveData();
                    renderDashboard();
                    renderInput();
                    renderConfig();
                    showToast('Daten erfolgreich importiert.');
                } catch (_) {
                    showToast('Die Datei konnte nicht gelesen werden.');
                } finally {
                    event.target.value = '';
                }
            };
            reader.readAsText(file);
        });

        function init() {
            renderDashboard();
            renderInput();
            renderConfig();
        }

        init();
    
