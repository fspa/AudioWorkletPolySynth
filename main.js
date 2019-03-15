Object.getOwnPropertyNames(Math).forEach(p => self[p] = Math[p]);
const clamp = (n, mi, ma) => max(mi, min(ma, n));
const gE = id => { return document.getElementById(id) };
let info, context, processor;

window.addEventListener("load", setup);
async function setup() {
    info = gE("info");
    paramContainers = gE("param-container");
    try {
        // context = new AudioContext({ latencyHint: 0.05, sampleRate: 24000 });
        context = new AudioContext();
        AudioWorklet;
    } catch (error) { info.textContent = error; return; }

    await context.audioWorklet.addModule('worklet.js');
    processor = new AudioWorkletNode(context, 'processor', { outputChannelCount: [2] });
    processor.onprocessorerror = e => { console.log(e); info.textContent = "error"; }
    processor.port.onmessage = e => info.textContent = e.data;

    setupParams();
    setupEvents();
    info.textContent = `sampleRate:${context.sampleRate}, baseLatency:${context.baseLatency}. press alphabet keys`;
}

function setupParams() {
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

function postMessage(id, value) {
    processor.port.postMessage({ id, value });
}
function createSlider(p){
    let divEl = document.createElement("div");
    divEl.id = p.name;
    divEl.classList.add("slider");
    
    let exp = p.exp || 1;
    let mi = p.minValue,  ma = p.maxValue, range = ma -mi;
    
    let value  = p.defaultValue;
    divEl.step = (p.step ? p.step : 0.01);

    let txt = p.name + (p.unit ? `(${p.unit})` : "");
    let textNode = document.createTextNode(" - " + txt);
    paramContainers.appendChild(divEl);
    paramContainers.appendChild(textNode);
    paramContainers.appendChild(document.createElement("BR"));

    setValue(value);
    function setValue(value){
        let v = (value/range)**(1/exp) *100;
        divEl.style.backgroundImage = `linear-gradient(to right, orange , orange , ${v}%, white, ${v}%, white)`;
        divEl.textContent = value.toFixed(3);
    }

    let mouseX = false, m = 1;
    divEl.addEventListener("mousedown",e=>{
        let rect = e.target.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        document.addEventListener("mousemove",moveHandler);
        document.addEventListener("mouseup",upHandler);
        sendValue(getValue());
    });
    function moveHandler(e){
        mouseX += e.movementX;
        sendValue(getValue());
    }
    function upHandler(){
        document.removeEventListener("mousemove",moveHandler);
        document.removeEventListener("mouseup",upHandler);
    }
    function getValue(v){
        v = clamp( (mouseX -m) / (divEl.clientWidth), 0, 1);
        divEl.style.backgroundImage = `linear-gradient(to right, orange , orange , ${v*100}%, white, ${v*100}%, white)`;
        v = mi + pow(v,exp)* range;
        divEl.textContent = v.toFixed(3);
        return v;
    }
    function sendValue(v){
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
    inputEl.type = p.type; // rangeは valueのあとに設定しないと動かない
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

function setupEvents() {
    let connecting = false;
    function connect() {
        window.removeEventListener("keydown", connect);
        connecting = !connecting;
        processor[(connecting ? "connect" : "disconnect")](context.destination);
        context[(connecting ? "resume" : "suspend")]();
        info.textContent = (connecting ? "connected. press alphabet keys" : "disconnected");
    }
    gE("connect").addEventListener("click", connect);
    window.addEventListener("keydown", connect);

    let pressedKeys = {};
    window.addEventListener("keydown", e => {
        if (pressedKeys[e.key]) return;
        pressedKeys[e.key] = true;
        postMessage("pcKeyDown", e.key);
    });
    window.addEventListener("keyup", e => {
        pressedKeys[e.key] = false;
        postMessage("pcKeyUp", e.key);
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