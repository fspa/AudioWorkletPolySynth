Object.getOwnPropertyNames(Math).forEach(p => self[p] = Math[p]);
const clamp = (n, mi, ma) => max(mi, min(ma, n));
const gE = id => { return document.getElementById(id) };
const gV = id => { return parseFloat(gE(id).value) };
let info, context, processor, pcKeyHandler;

window.addEventListener("load", async function setup() {
    info = gE("info");
    paramContainers = gE("param-container");
    try { await init(1); } catch (error) { info.textContent = error; return; }
    setupEvents();
});

function setupEvents() {
    gE("init").addEventListener("click", init);
    gE("connect").addEventListener("click", connect);

    let pressedKeys = {};
    window.addEventListener("keydown", e => {
        if (pressedKeys[e.key]) return;
        pressedKeys[e.key] = true;
        pcKeyHandler.port.postMessage({ id: "keydown", value: e.key });
    });
    window.addEventListener("keyup", e => {
        pressedKeys[e.key] = false;
        pcKeyHandler.port.postMessage({ id: "keyup", value: e.key });
    });

    const checkboxList = document.querySelectorAll("input[type='checkbox']");
    for (let c of checkboxList) c.addEventListener("change", _ => {
        let binaryData = 0;
        for (let i = checkboxList.length - 1; i >= 0; i--) {
            binaryData <<= 1;
            if (checkboxList[i].checked) binaryData += 1;
        }
        postMessage("scale", binaryData);
    });
}

async function init(first) {
    connecting = false;
    if (context) context.close();
    let lh = (first === 1) ? undefined : gV("latency");
    context = new AudioContext({ latencyHint: lh });
    // context = new AudioContext({ latencyHint: lh, sampleRate: 24000 });

    await context.audioWorklet.addModule('worklet.js');
    processor = await new AudioWorkletNode(context, 'processor', { outputChannelCount: [2] });
    processor.onprocessorerror = e => { console.log(e); info.textContent = "error"; }
    processor.port.onmessage = e => {
        if (typeof e.data == "string") info.textContent = e.data;
        else gE(e.data.id).value = e.data.value;

    }

    pcKeyHandler = await new AudioWorkletNode(context, "pcKeyHandler");
    setupParams();

    gE("latency").value = context.baseLatency;
    if (first === 1) {
        info.textContent = `sampleRate:${context.sampleRate}, baseLatency:${context.baseLatency}. press any keys`;
        window.addEventListener("keydown", connect);
        window.addEventListener("mousemove", connect);
    }
    else {
        connect();
        info.textContent = `sampleRate:${context.sampleRate}, baseLatency:${context.baseLatency}.`;
    }
}

function connect() {
    window.removeEventListener("keydown", connect);
    window.removeEventListener("mousemove", connect);

    connecting = !connecting;
    context[(connecting ? "resume" : "suspend")]();
    processor[(connecting ? "connect" : "disconnect")](context.destination);
    analyser[(connecting ? "setup" : "stop")]();
    info.textContent = (connecting ? "connected. press alphabet keys" : "disconnected");
}

function postMessage(id, value) {
    processor.port.postMessage({ id, value });
}

const analyser = {
    isRunning: false,
    posList: [],
    guideList: [],
    guideListBold: [],
    buffer: null,
    setup() {
        this.element = gE("analyser");
        this.width = this.element.width;
        this.height = this.element.height;
        this.canvasCtx = this.element.getContext("2d");

        this.node = context.createAnalyser();
        this.bufferSize = this.node.frequencyBinCount;

        this.buffer = new Uint8Array(this.bufferSize);
        this.setupGuide(this.bufferSize, this.width);
        processor.connect(this.node);
        this.loop();
    },
    setupGuide(bufferSize, w) {
        let nyquistF = context.sampleRate / 2
        let leftEnd = log2(1 / bufferSize * nyquistF);
        let rightEnd = log2(nyquistF) - leftEnd;
        for (let i = 0; i < bufferSize; i++) {
            let hz = i / bufferSize * nyquistF;
            this.posList[i] = (log2(hz) - leftEnd) / rightEnd * w;
        }
        for (let hz = 25; hz < nyquistF; hz *= 2) {
            let x = (log2(hz) - leftEnd) / rightEnd * w;
            this.guideList.push(round(x));
        }
        [100, 1000, 10000].forEach(n => {
            let x = (log2(n) - leftEnd) / rightEnd * w;
            this.guideListBold.push(round(x));
        });
    },
    stop() {
        cancelAnimationFrame(this.animId);
    },
    loop() {
        this.draw(this.canvasCtx, this.bufferSize, this.width, this.height);
        this.animId = requestAnimationFrame(this.loop.bind(this));
    },
    draw(cc, bufferSize, w, h) {
        cc.fillStyle = "orange";
        cc.fillRect(0, 0, w, h);
        cc.fillStyle = "#888";
        for (let i = 0, l = this.guideList.length; i < l; i++) {
            cc.fillRect(this.guideList[i], 0, 1, h);
        }
        cc.fillStyle = "#444";
        for (let i = 0, l = this.guideListBold.length; i < l; i++) {
            cc.fillRect(this.guideListBold[i], 0, 1, h);
        }

        this.node.getByteFrequencyData(this.buffer);
        cc.strokeStyle = "white";
        cc.lineWidth = 2;
        cc.beginPath();
        cc.moveTo(-1, h);
        for (let i = 0, c = h / 256; i < bufferSize; i++) {
            let y = h - this.buffer[i] * c;
            cc.lineTo(this.posList[i], y);
        }
        cc.moveTo(w, h);
        cc.stroke();
    }
}

// 以下インタラクティブ用
function setupParams() {
    gE("param-container").innerHTML = "";
    let setupMessenger = new AudioWorkletNode(context, "setup");
    setupMessenger.port.onmessage = function handleMessage(event) {
        createParameters(event.data);
    }
    setupMessenger.port.postMessage(1);
}

function createParameters(params) {
    for (let p of params) {
        if (p.type == "none") continue;
        if (p.type == null) p.type = "slider";
        if (p.type == "separator") {
            let el = document.createElement("h3");
            el.textContent = p.value;
            paramContainers.appendChild(el);
        }
        else if (p.type == "slider") createSlider(p);
        else createInput(p);
    }
}

function createSlider(p) {
    let divEl = document.createElement("div");
    divEl.id = p.name;
    divEl.classList.add("slider");

    let exp = p.exp || 1;
    let mi = p.minValue, ma = p.maxValue, range = ma - mi;

    let value = p.defaultValue;
    divEl.step = (p.step ? p.step : 0.01);

    let txt = p.name + (p.unit ? `(${p.unit})` : "");
    let textNode = document.createTextNode(" - " + txt);
    paramContainers.appendChild(divEl);
    paramContainers.appendChild(textNode);
    paramContainers.appendChild(document.createElement("BR"));

    setValue(value);
    function setValue(value) {
        let v = (value / range) ** (1 / exp) * 100;
        divEl.style.backgroundImage = `linear-gradient(to right, orange , orange , ${v}%, white, ${v}%, white)`;
        divEl.textContent = value.toFixed(3);
    }

    let mouseX = false, m = 1;
    divEl.addEventListener("mousedown", e => {
        let rect = e.target.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        document.addEventListener("mousemove", moveHandler);
        document.addEventListener("mouseup", upHandler);
        sendValue(getValue());
    });
    function moveHandler(e) {
        mouseX += e.movementX;
        sendValue(getValue());
    }
    function upHandler() {
        document.removeEventListener("mousemove", moveHandler);
        document.removeEventListener("mouseup", upHandler);
    }
    function getValue(v) {
        v = clamp((mouseX - m) / (divEl.clientWidth), 0, 1);
        divEl.style.backgroundImage = `linear-gradient(to right, orange , orange , ${v * 100}%, white, ${v * 100}%, white)`;
        v = mi + pow(v, exp) * range;
        divEl.textContent = v.toFixed(3);
        return v;
    }
    function sendValue(v) {
        if (!p.ramp) postMessage(p.name, v)
        else processor.parameters.get(p.name).linearRampToValueAtTime(v, context.currentTime + (p.time || 0.1));
    }
}

function createInput(p) {
    let inputEl = document.createElement("input");
    inputEl.id = p.name;
    let exp = p.exp || 1;
    inputEl.min = p.minValue ** (1 / exp);
    inputEl.max = p.maxValue ** (1 / exp);
    inputEl.value = p.defaultValue ** (1 / exp);
    inputEl.step = (p.step ? p.step : 0.01);
    inputEl.type = p.type; // rangeは valueのあとに設定
    let txt = p.name + (p.unit ? `(${p.unit})` : "");
    let textNode = document.createTextNode(" - " + txt);
    paramContainers.appendChild(inputEl);
    paramContainers.appendChild(textNode);
    paramContainers.appendChild(document.createElement("BR"));

    if (!p.ramp) inputEl.addEventListener("change", _ => postMessage(p.name, pow(inputEl.value, exp)));
    else inputEl.addEventListener("change", _ => {
        let value = inputEl.value;
        info.textContent = p.name + " " + value;
        processor.parameters.get(p.name).linearRampToValueAtTime(value, context.currentTime + (p.time || 0.1));
    });
}
