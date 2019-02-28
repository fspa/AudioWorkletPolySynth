const Fs = sampleRate, Ts = 1 / Fs;
const random = Math.random, exp = Math.exp, pow = Math.pow, sign = Math.sign, abs = Math.abs, round = Math.round, floor = Math.floor, max = Math.max, min = Math.min, tanh = Math.tanh, sin = Math.sin, cos = Math.cos, PI = Math.PI, twoPI = PI * 2, atan = Math.atan;
const clamp = (n, mi, ma) => max(mi, min(ma, n));
const octave = (hz, oct = 0) => hz * pow(2, oct);
const siT = function (t) { return sin(twoPI * t) }
const waveShaperFrac = (x, k = 1) => sign(x) * (1 - k / (k + abs(x)));

class PmPair {
    constructor(hz = 400, hzX = 2, lv = 2) {
        [this.hz, this.hzX, this.lv] = [hz, hzX, lv];
        [this.a, this.cPhase, this.mPhase] = [twoPI / Fs, 0, 0];
    }
    exec(hz = this.hz, hzX = this.hzX, lv = this.lv) {
        let inc = hz * this.a;
        this.cPhase += inc;
        this.mPhase += inc * hzX;
        return sin(this.cPhase + lv / hzX * sin(this.mPhase));
    }
    static create(hz, mHzX, lv) { let c = new PmPair(...arguments); return c.exec.bind(c); }
}

class ADSR {// multi trigger, linear
    constructor(a = 0.01, d = 0.1, s = 0.3, r = 0.1) {
        this.inc = this.dDec = this.rDec = this.vol = this.index = 0;
        [this.ai, this.di, this.ri, this.s] = [a * Fs, d * Fs, r * Fs, s];
        this.aTarget = this.dTarget = 0;
        this.isDecaying = false;
        this.isOn = false;
        this.gate = 0;
    }
    setA(arg) { this.ai = arg * Fs; }
    setD(arg) { this.di = arg * Fs; }
    setR(arg) { this.ri = arg * Fs; }
    setS(arg) { this.s = arg; }
    exec() {
        if (this.isOn) {
            if (!this.isDecaying) {
                if (this.vol < this.aTarget) this.vol = min(this.aTarget, this.vol + this.inc);
                else this.isDecaying = true;
            }
            else this.vol = max(this.dTarget, this.vol - this.dDec);
        }
        else this.vol = max(0, this.vol - this.rDec);
        return this.vol;
    }
    noteOn(amp = 1) {
        this.index = 0;
        this.amp = amp;
        this.inc = amp / this.ai;
        this.dDec = amp * (1 - this.s) / this.di;
        this.rDec = amp * this.s / this.ri;
        this.aTarget = amp;
        this.dTarget = amp * this.s;
        this.isDecaying = false;
        this.isOn = true;
    }
    noteOff() {
        this.isOn = false;
        this.rDec = this.amp * this.vol / this.ri;
    }
    input(gate, amp = 1) {
        if (gate == this.gate) return;
        if (gate) this.noteOn(amp);
        else this.noteOff();
        this.gate = gate;
    }
}

class PolySynthesizer {
    constructor(monoSynth, numVoices = 2) {
        this.assigner = new this.Assigner(numVoices);
        this.synths = [];
        this.numVoices = numVoices;
        for (let i = 0; i < 16; i++)this.synths.push(new monoSynth());

    }
    changeNumVoice(num) {
        if (this.numVoices == num) return;
        this.numVoices = num;
        this.assigner.setup(num);
    }
    noteOn(number, velocity = 1) {
        let aInd = this.assigner.setIndex(number);
        this.synths[aInd].noteOn(number, velocity);
    }
    noteOff(number) {
        let aInd = this.assigner.getIndex(number);
        if (aInd != -1) this.synths[aInd].noteOff();
    }
    exec() {
        let s = 0;
        for (let i = 0; i < this.numVoices; i++) {
            switch (this.synths[i].state) {
                case 0: break;
                case 1: case 2:
                    s += this.synths[i].exec(arguments);
                    break;
                case 3:
                    this.assigner.release(this.synths[i].noteNumber);
                    this.synths[i].state = 0;
                    break;
            }
        }
        return s;
    }
}

PolySynthesizer.prototype.Assigner = class {
    constructor(num = 2) {
        this.setup(num);
    }
    setup(num) {
        this.num = num;
        this.assignmentList = new Array(16).fill(undefined);
        this.countList = [];
    }
    setIndex(noteNumber) {
        // 使用中ならインデックスを返す TODO: リリース後なら別のインデックスを使う
        let aIndex = this.assignmentList.indexOf(noteNumber);
        if (aIndex != -1) return aIndex;

        //　割り当てる
        for (let i = 0, li = this.assignmentList, l = this.num; i < l; i++) {
            if (li[i] === undefined) {
                li[i] = noteNumber;
                this.countList.push(i);
                return i;
            }
        }

        // 空きがなければ最初に使ったものを使う 
        let n = this.countList[this.countList.length - this.num];
        this.assignmentList[n] = noteNumber;
        this.countList.push(n);

        return n;
    }
    getIndex(noteNumber) {
        let aIndex = this.assignmentList.indexOf(noteNumber);
        return aIndex;
    }
    release(noteNumber) {
        let aIndex = this.assignmentList.indexOf(noteNumber);
        this.assignmentList[aIndex] = undefined;
    }
}

/////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////


function changeScale(v = 151) {
    let harmonics = [], baseHz = 50;

    for (let i = 0; i < 8; i++) {
        if (v % 2 == 1) harmonics.push(i + 8);
        v >>>= 1;
    }

    scale = [];
    for (let i = 0; i < 8; i++) {
        harmonics.forEach(e => scale.push(e * 2 ** i * baseHz / 8));
    }
}

const constParams = {
    descriptors: {},
    setup() {
        for (let p of parameters) {
            if (p.ramp) {
                parameterDescriptors.push(p);
                continue;
            }
            this.descriptors[p.name] = p;
            this[p.name] = p.defaultValue;
        }
    },
    change(id, value) {
        let p = this.descriptors[id];
        let clampedValue = clamp(parseFloat(value), p.minValue, p.maxValue);
        this[id] = clampedValue;
        let cp = constParams;
        for (let i = 0, syn = polySynth.synths, l = syn.length; i < l; i++) {
            syn[i].ADSR.setA(cp.carrierA);
            syn[i].ADSR.setD(cp.carrierD);
            syn[i].ADSR.setS(cp.carrierS);
            syn[i].ADSR.setR(cp.carrierR);
            syn[i].fmLvEnv.setA(cp.freqModA);
            syn[i].fmLvEnv.setD(cp.freqModD);
            syn[i].fmLvEnv.setS(cp.freqModS);
            syn[i].fmLvEnv.setR(cp.freqModR);
            syn[i].pmLvEnv.setA(cp.phaseModA);
            syn[i].pmLvEnv.setD(cp.phaseModD);
            syn[i].pmLvEnv.setS(cp.phaseModS);
            syn[i].pmLvEnv.setR(cp.phaseModR);
        }
        polySynth.changeNumVoice(cp.numVoices)
        if (value == clampedValue) return id + " " + value;
        else return id + " clamped " + clampedValue;
    }
}


const parameters = [
    { name: 'numVoices', type: "number", defaultValue: 4, minValue: 1, maxValue: 16, step: 1 },
    { type: "separator", value: "amplitude" },
    { name: 'carrierA', defaultValue: 0.01, minValue: 0.01, maxValue: 2, exp: 2 },
    { name: 'carrierD', defaultValue: 0.1, minValue: 0.01, maxValue: 2 },
    { name: 'carrierS', defaultValue: 0.3, minValue: 0, maxValue: 1 },
    { name: 'carrierR', defaultValue: 0.2, minValue: 0.01, maxValue: 2 },
    { type: "separator", value: "timbre" },
    { name: 'phaseModFreq', type: "number", defaultValue: 1, minValue: 0.25, maxValue: 16, step: 0.25, unit: "ratio" },
    { name: 'phaseModLv', defaultValue: 1, minValue: 0., maxValue: 4 },
    { name: 'phaseModA', defaultValue: 0.01, minValue: 0.00, maxValue: 2, exp: 2 },
    { name: 'phaseModD', defaultValue: 0.5, minValue: 0.01, maxValue: 2 },
    { name: 'phaseModS', defaultValue: 0.3, minValue: 0, maxValue: 1 },
    { name: 'phaseModR', defaultValue: 0.2, minValue: 0.01, maxValue: 5 },
    { type: "separator", value: "vibrato" },
    { name: 'freqModFreq', defaultValue: 4, minValue: 0.25, maxValue: 400, unit: "Hz", exp: 3 },
    { name: 'freqModLv', defaultValue: 0.25, minValue: 0, maxValue: 12, unit: "semi", exp: 2 },
    { name: 'freqModA', defaultValue: 1, minValue: 0.00, maxValue: 2 },
    { name: 'freqModD', defaultValue: 1, minValue: 0.01, maxValue: 2 },
    { name: 'freqModS', defaultValue: 1, minValue: 0, maxValue: 1 },
    { name: 'freqModR', defaultValue: 1, minValue: 0.01, maxValue: 5 },
    { type: "separator", value: "distortion" },
    { name: 'distortionIn', ramp: true, defaultValue: 5, minValue: 0, maxValue: 10 },
    { name: 'distortionDrive', ramp: true, defaultValue: 0, minValue: 0, maxValue: 9 },
    { name: 'distortionDry', ramp: true, defaultValue: 0.25, minValue: 0, maxValue: 1, unit: "ratio" },
    { name: 'masterAmp', type: "number", defaultValue: 1, minValue: 0, maxValue: 1 },
];


/////////////////////////////////////////////////////////////////////////
let parameterDescriptors = [];
class Processor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);

    }
    static get parameterDescriptors() {
        return parameterDescriptors;
    }
    handleMessage(event) {
        let id = event.data.id, value = event.data.value;
        if (id == "pcKeyDown") {
            const n = "zxcvbnmasdfghjklqwertyuiop".indexOf(value);
            if (n != -1) polySynth.noteOn(n);
            return;
        }
        if (id == "pcKeyUp") {
            const n = "zxcvbnmasdfghjklqwertyuiop".indexOf(value);
            if (n != -1) polySynth.noteOff(n);
            return;
        }
        if (id == "scale") { changeScale(value); return; }
        let result = constParams.change(id, value, this);
        this.port.postMessage(result);
    }
}

Processor.prototype.process = function process(inputs, outputs, parameters) {
    const outL = outputs[0][0];
    const outR = outputs[0][1];
    const bufferLen = outL.length;
    const dIn = parameters.distortionIn, isDistortionInConstant = dIn.length === 1;
    const dDry = parameters.distortionDry, isDistortionDryConstant = dDry.length === 1;
    const dDrive = parameters.distortionDrive, isDistortionDriveConstant = dDrive.length === 1;

    for (let i = 0; i < bufferLen; i++) {
        let s = polySynth.exec() / 2;
        let dry = (isDistortionDryConstant ? dDry[0] : dDry[i]);
        let driveIn = (isDistortionInConstant ? dIn[0] : dIn[i]);
        s = s * dry + (1 - dry) * waveShaperFrac(driveIn * s, 10 - (isDistortionDriveConstant ? dDrive[0] : dDrive[i]))
        s /= (dry * 2 + (1 - dry) * waveShaperFrac(driveIn * 2, dry));
        s *= constParams.masterAmp;
        outR[i] = outL[i] = s;
        if (abs(s) > 1) this.port.postMessage("clipped!");
    }
    return true;
}
/////////////////////////////////////////////////////////////////////////

class MonoSynthesizer {
    constructor() {
        this.pm = PmPair.create(1, 1, 0.25);
        this.ADSR = new ADSR(0.01, 0.1, 0.3, 0.2);
        this.pmLvEnv = new ADSR(0.01, 0.5, 0.3, 0.2);
        this.fmLvEnv = new ADSR(1, 1, 1, 1);
        this.state = 0;
        this.fmPhase = 0;
    }
    noteOn(noteNumber, vel = 1) {
        this.noteNumber = noteNumber;
        this.hz = scale[noteNumber];
        this.vel = vel;
        this.ADSR.noteOn(vel);
        this.pmLv = constParams.phaseModLv;
        this.fmLvEnv.vol = 0;
        this.fmPhase = 0;
        this.pmLvEnv.noteOn(vel);
        this.fmLvEnv.noteOn(vel);
        this.state = 1;
    }
    noteOff() {
        this.ADSR.noteOff();
        this.pmLvEnv.noteOff();
        this.fmLvEnv.noteOff();
        this.state = 2;
    }
    exec() {
        let vol = this.ADSR.exec();
        if (vol === 0) {
            this.state = 3;
            this.pmLvEnv.vol = 0;
        }
        this.fmPhase += constParams.freqModFreq / Fs;
        let fmLv = octave(this.hz, constParams.freqModLv / 12) - this.hz;
        let fm = siT(this.fmPhase) * fmLv * this.fmLvEnv.exec();
        return this.pm(this.hz + fm, constParams.phaseModFreq, this.pmLv * this.pmLvEnv.exec()) * vol;
    }
}
let polySynth = new PolySynthesizer(MonoSynthesizer, 4);
let scale;

changeScale(151);
constParams.setup();
registerProcessor('processor', Processor);
registerProcessor('setup', class extends Processor {
    constructor() {
        super();
        let t = this;
        this.port.onmessage = _ => t.port.postMessage(parameters);
    }
});