document.addEventListener('DOMContentLoaded', function() {
// get data from api and wire up simple range pickers
var heights = [];
var timestamps = [];
var a, b, c, h, offset;
var pastChart;
var eventsForGraph = [];

let futureSwitch = document.getElementById("futureSwitch") || document.getElementById("futureCheckbox");
let startPicker = document.getElementById('startPicker');
let endPicker = document.getElementById('endPicker');
let applyRangeButton = document.getElementById('applyRangeButton');
var currentEndUnix = null;
let predictionMode = document.getElementById('predictionMode');
var utidePoints = null;

if (!futureSwitch) {
    console.warn('generate_graph.js: no future switch checkbox found (tried futureSwitch and futureCheckbox)');
}
if (!startPicker || !endPicker || !applyRangeButton || !predictionMode) {
    console.warn('generate_graph.js: one or more expected controls are missing', {
        startPicker: !!startPicker,
        endPicker: !!endPicker,
        applyRangeButton: !!applyRangeButton,
        predictionMode: !!predictionMode
    });
}

function pad(n){ return n < 10 ? '0'+n : n }
function unixToLocalDatetimeInput(unix) {
    let d = new Date(unix * 1000);
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function datetimeLocalToUnix(inputOrVal) {
    if (!inputOrVal) return null;
    let val;
    if (typeof inputOrVal === 'string') {
        val = inputOrVal;
    } else if (inputOrVal instanceof HTMLInputElement) {
        val = inputOrVal.value;
        if (!val && inputOrVal.valueAsDate instanceof Date) {
            val = inputOrVal.valueAsDate.toISOString().slice(0, 16);
        }
    } else {
        val = String(inputOrVal);
    }

    if (!val) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        val = val + 'T00:00';
    }

    let dt = new Date(val);
    if (isNaN(dt.getTime()) && inputOrVal instanceof HTMLInputElement && inputOrVal.valueAsNumber) {
        dt = new Date(inputOrVal.valueAsNumber);
    }
    return isNaN(dt.getTime()) ? null : Math.floor(dt.getTime() / 1000);
}

// default start roughly matches previous behavior
var defaultStart = parseInt(Date.now() / 1000) - 14400 - 43200;
startPicker.value = unixToLocalDatetimeInput(defaultStart);
endPicker.value = '';

if (applyRangeButton) {
    applyRangeButton.addEventListener('click', () => {
        let startUnix = datetimeLocalToUnix(startPicker ? startPicker.value : null) || defaultStart;
        let endUnix = datetimeLocalToUnix(endPicker ? endPicker.value : null);
        loadData(startUnix, endUnix);
    });
}

if (futureSwitch) {
    futureSwitch.addEventListener('change', () => {
        // if enabling future and using UTide, reload to fetch UTide; otherwise refresh
        if (futureSwitch.checked && predictionMode && predictionMode.value === 'utide') {
            let startUnix = datetimeLocalToUnix(startPicker ? startPicker.value : null) || defaultStart;
            let endUnix = datetimeLocalToUnix(endPicker ? endPicker.value : null);
            loadData(startUnix, endUnix);
        } else {
            refreshGraph();
        }
    });
} else {
    console.warn('generate_graph.js: futureSwitch event binding skipped because checkbox is missing');
}

predictionMode.addEventListener('change', () => {
    // switching prediction mode likely requires fetching different prediction data
    let startUnix = datetimeLocalToUnix(startPicker.value) || defaultStart;
    let endUnix = datetimeLocalToUnix(endPicker.value);
    loadData(startUnix, endUnix);
});

// initial load
loadData(defaultStart, null);

function loadData(startUnix, endUnix) {
    heights = [];
    timestamps = [];
    currentEndUnix = endUnix || null;

    let url = 'https://octidesapi.andrewtrackim.com/get-depth-range?start_time=' + startUnix;
    if (endUnix) url += '&end_time=' + endUnix;

    utidePoints = null;
    let depthPromise = fetch(url)
        .then(response => response.json())
        .then(data => {
            let points = data['tidePoints'] || [];
            for (var i = 0; i < points.length; i++) {
                heights.push(points[i]['depth']);
                timestamps.push(points[i]['unixTime']);
            }
        })
        .catch(err => { console.warn('depth range fetch failed', err); });
    // after depths are loaded decide which prediction source to use
    let predPromise = depthPromise.then(() => {
        // if UTide mode is selected and user wants future predictions, call UTide endpoint
        if (predictionMode.value === 'utide' && futureSwitch.checked && timestamps.length > 0) {
            let startTime = timestamps[timestamps.length - 1] + (60 - timestamps[timestamps.length - 1] % 60);
            // compute hours from startTime to requested end (or default 12 hours)
            let hours = 12;
            if (currentEndUnix) {
                hours = Math.max(0, Math.round((currentEndUnix - startTime) / 3600));
            }
            hours = Math.max(1, Math.min(hours, 240));
            let urlU = 'https://octidesapi.andrewtrackim.com/utide-future-graph?hours=' + hours;
            return fetch(urlU)
                .then(r => r.json())
                .then(data => {
                    utidePoints = data['futurePoints'] || [];
                    if (currentEndUnix) {
                        utidePoints = utidePoints.filter(pt => {
                            let t = pt['unixTime'] || pt['time'] || null;
                            return t && t <= currentEndUnix;
                        });
                    }
                    // clear simple prediction parameters so refreshGraph knows to use utidePoints
                    a = undefined;
                })
                .catch(err => { console.warn('utide fetch failed', err); utidePoints = null; });
        } else {
            // fallback to basic prediction endpoint
            return fetch('https://octidesapi.andrewtrackim.com/prediction')
                .then(response => response.json())
                .then(data => {
                    a = data['a'];
                    b = data['b'];
                    c = data['c'];
                    h = data['h'];
                    offset = data['offset'];
                })
                .catch(err => { /* prediction may be unavailable */ });
        }
    });

    // fetch events for graph (past events within the same range)
    let eventsPromise = fetch('https://octidesapi.andrewtrackim.com/get-tide-events-range?start_time=' + startUnix + '&end_time=' + (endUnix ? endUnix : Math.floor(Date.now()/1000)))
        .then(r => r.json())
        .then(data => {
            let ev = data['tideEvents'] || [];
            // keep only past events (<= now) for marking
            let now = Math.floor(Date.now() / 1000);
            eventsForGraph = ev.filter(e => {
                let t = e['event_time'] || e['unixTime'] || e['eventTime'];
                return t && t <= now;
            });
        })
        .catch(err => { console.warn('events for graph fetch failed', err); eventsForGraph = []; });

    Promise.all([depthPromise, predPromise, eventsPromise]).then(() => {
        refreshGraph();
    });
}

function refreshGraph() {
    if (heights.length > 0) {
        let predictedHeights = [];
        let predictedTimestamps = [];

        // If UTide points are available and user selected UTide mode, use those
        if (predictionMode.value === 'utide' && futureSwitch.checked && utidePoints && utidePoints.length > 0) {
            for (var i = 0; i < utidePoints.length; i++) {
                predictedHeights.push(utidePoints[i]['depth']);
                predictedTimestamps.push(utidePoints[i]['unixTime']);
            }
        } else if (a != undefined && futureSwitch.checked && timestamps.length > 0) {
            let startTime = timestamps[timestamps.length - 1] + (60 - timestamps[timestamps.length - 1] % 60);
            // determine number of minutes to predict: use endPicker if provided, otherwise default 720
            let steps = 720; // default ~12 hours
            if (currentEndUnix) {
                // only predict forward from startTime
                let seconds = currentEndUnix - startTime;
                steps = Math.max(0, Math.ceil(seconds / 60));
                // cap steps to avoid runaway allocations
                steps = Math.min(steps, 10000);
            }
            for (var i = 0; i < steps; i++) {
                let currTime = parseInt(startTime + i * 60 - offset);
                let newValue = a * Math.sin(b * currTime + c) + h;
                predictedHeights.push(newValue);
                predictedTimestamps.push(startTime + i * 60);
            }
            if (currentEndUnix) {
                // trim any points beyond the requested end date
                while (predictedTimestamps.length > 0 && predictedTimestamps[predictedTimestamps.length - 1] > currentEndUnix) {
                    predictedTimestamps.pop();
                    predictedHeights.pop();
                }
            }
        }

        let allHeights = heights.concat(predictedHeights);
        let allTimestamps = timestamps.concat(predictedTimestamps);

        // convert timestamps to date objects to display on graph
        var times = new Array(allTimestamps.length);
        for (var i = 0; i < times.length; i ++) {
            times[i] = new Date(allTimestamps[i] * 1000);
        }

        // color future predicted points differently from historical data points
        let pointBackgroundColors = new Array(times.length);
        for (var i = 0; i < times.length; i++) {
            pointBackgroundColors[i] = i < timestamps.length ? '#025bba' : '#7fa9e8';
        }

        // prepare event markers dataset
        let eventData = [];
        let eventColors = [];
        for (let i = 0; i < eventsForGraph.length; i++) {
            let ev = eventsForGraph[i];
            let t = ev['event_time'] || ev['unixTime'] || ev['eventTime'];
            let d = ev['depth'] || ev['start_depth'] || null;
            if (!t || d === null) continue;
            eventData.push({ x: new Date(t * 1000), y: d });
            // high: darker red, low: darker blue
            let type = ev['event_type'] || ev['eventType'] || '';
            eventColors.push(type && type.toLowerCase().indexOf('high') !== -1 ? '#b02a37' : '#2a9d2a');
        }

        let past = document.getElementById('past').getContext('2d');
        if (pastChart != undefined) {
            pastChart.destroy();
        }
        pastChart = new Chart(past, {
            type:'line',
            data:{
                labels: times,
                datasets: [
                    {
                        label: "depth",
                        data: allHeights,
                        borderColor: '#025bba',
                        borderWidth: 2,
                        fill: true,
                        pointRadius: 2,
                        pointHoverRadius: 4,
                        pointBackgroundColor: pointBackgroundColors,
                        pointBorderWidth: 0,
                        order: 1
                    },
                    {
                        label: 'Tide Events',
                        data: eventData,
                        type: 'scatter',
                        pointRadius: 10,
                        pointHoverRadius: 12,
                        pointBorderWidth: 3,
                        pointStyle: 'circle',
                        showLine: false,
                        backgroundColor: eventColors,
                        borderColor: '#ffffff',
                        order: 2
                    }
                ]
            },

            options:{
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'minute'
                        }
                    }
                }
            }
        });
}

// --- Tide events table UI and fetching ---
let eventsStart = document.getElementById('eventsStart');
let eventsEnd = document.getElementById('eventsEnd');
let eventsApply = document.getElementById('eventsApply');
let eventsTbody = document.getElementById('eventsTbody');
let events24Toggle = document.getElementById('events24Toggle');
var eventsCache = [];

function pad2(n){ return n < 10 ? '0'+n : n }
function formatDateInput(dt){ return dt.getFullYear() + '-' + pad2(dt.getMonth()+1) + '-' + pad2(dt.getDate()); }

// default: start = today -2 days, end = today +2 days
let today = new Date();
let defaultStartDate = new Date(today);
defaultStartDate.setDate(today.getDate() - 2);
let defaultEndDate = new Date(today);
defaultEndDate.setDate(today.getDate() + 2);
eventsStart.value = formatDateInput(defaultStartDate);
eventsEnd.value = formatDateInput(defaultEndDate);

eventsApply.addEventListener('click', () => {
    let s = eventsStart.value;
    let e = eventsEnd.value;
    let startUnix = null;
    let endUnix = null;
    if (s) startUnix = Math.floor(new Date(s + 'T00:00:00').getTime() / 1000);
    if (e) endUnix = Math.floor(new Date(e + 'T23:59:59').getTime() / 1000);
    loadEvents(startUnix, endUnix);
});

function formatDuration(seconds) {
    if (seconds == null || seconds === undefined) return '';
    seconds = Number(seconds);
    if (isNaN(seconds)) return '';
    let hrs = Math.floor(seconds / 3600);
    let mins = Math.floor((seconds % 3600) / 60);
    let secs = Math.floor(seconds % 60);
    return `${hrs} h ${mins} m ${secs} s`;
}

function loadEvents(startUnix, endUnix) {
    let url = 'https://octidesapi.andrewtrackim.com/get-tide-events-range?';
    if (startUnix) url += 'start_time=' + startUnix;
    if (endUnix) url += (startUnix ? '&' : '') + 'end_time=' + endUnix;

    // fetch recorded events first
    fetch(url)
        .then(r => r.json())
        .then(async data => {
            let events = data['tideEvents'] || [];
            // if the requested range extends into the future, fetch UTide predicted future events
            let now = Math.floor(Date.now() / 1000);
            if (endUnix && endUnix > now) {
                let hours = Math.max(1, Math.round((endUnix - now) / 3600));
                hours = Math.min(hours, 240);
                try {
                    let uresp = await fetch('https://octidesapi.andrewtrackim.com/utide-future-events?hours=' + hours);
                    let udata = await uresp.json();
                    let fut = udata['futureEvents'] || [];
                    // merge recorded events with future predicted events, avoiding duplicates by event_time
                    let map = {};
                    events.forEach(ev => { map[(ev['event_time'] || ev['unixTime'] || ev['eventTime'])] = ev; });
                    fut.forEach(ev => { map[(ev['event_time'] || ev['unixTime'] || ev['eventTime'])] = ev; });
                    // convert map back to array
                    events = Object.keys(map).map(k => map[k]);
                } catch (err) {
                    console.warn('utide future events fetch failed', err);
                }
            }
            // sort events chronologically by their timestamp key
            events.sort((a,b) => {
                let ta = a['event_time'] || a['unixTime'] || a['eventTime'];
                let tb = b['event_time'] || b['unixTime'] || b['eventTime'];
                return ta - tb;
            });
            populateEventsTable(events);
        })
        .catch(err => {
            console.warn('tide events fetch failed', err);
            eventsTbody.innerHTML = '<tr><td colspan="4">Failed to load events</td></tr>';
        });
}

function populateEventsTable(events) {
    eventsTbody.innerHTML = '';
    if (!events || events.length === 0) {
        eventsTbody.innerHTML = '<tr><td colspan="4">No events found for this range</td></tr>';
        return;
    }
    // cache for re-rendering when toggling time format
    eventsCache = events;
    let now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < events.length; i++) {
        let ev = events[i];
        // API may use different keys; normalize
        let unix = ev['event_time'] || ev['unixTime'] || ev['unixTime'];
        let dateObj = new Date(unix * 1000);
        let dateStr = dateObj.getFullYear() + '-' + pad2(dateObj.getMonth()+1) + '-' + pad2(dateObj.getDate());
        let use24 = events24Toggle ? events24Toggle.checked : true;
        let hours = dateObj.getHours();
        let mins = pad2(dateObj.getMinutes());
        let secs = pad2(dateObj.getSeconds());
        let timeStr = '';
        if (use24) {
            timeStr = pad2(hours) + ':' + mins + ':' + secs;
        } else {
            let h12 = hours % 12 || 12;
            let ampm = hours < 12 ? 'AM' : 'PM';
            timeStr = h12 + ':' + mins + ':' + secs + ' ' + ampm;
        }
        let type = ev['event_type'] || ev['eventType'] || ev['event_type'] || '';
        let depthValue = ev['depth'] || ev['event_depth'] || ev['start_depth'] || ev['depth_m'] || '';
        let depthDisplay = depthValue !== null && depthValue !== undefined && depthValue !== '' ? Number(depthValue).toFixed(2) : '';
        let durationFormatted = formatDuration(ev['duration_seconds'] || ev['duration_seconds'] === 0 ? ev['duration_seconds'] : ev['duration_seconds']);
        let isPredicted = unix > now;
        let tr = document.createElement('tr');
        if (isPredicted) {
            tr.classList.add('future');
        }
        tr.innerHTML = `<td>${dateStr} ${timeStr}</td><td>${type}</td><td>${depthDisplay}</td><td>${durationFormatted}</td>`;
        eventsTbody.appendChild(tr);
    }
}

// re-render table when time-format toggled
if (events24Toggle) {
    events24Toggle.addEventListener('change', () => {
        populateEventsTable(eventsCache);
    });
}

// initial load with defaults
let defStartUnix = Math.floor(new Date(formatDateInput(defaultStartDate) + 'T00:00:00').getTime() / 1000);
let defEndUnix = Math.floor(new Date(formatDateInput(defaultEndDate) + 'T23:59:59').getTime() / 1000);
loadEvents(defStartUnix, defEndUnix);
}});