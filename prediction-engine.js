// ============================================================================
// PREDICTION ENGINE v3.0 — 9-MODEL PREMIUM ENSEMBLE
// Markov · Pattern · Streak · Bayesian · Cyclic · Recency · Bias · Sector · NeuralWeighted
// Adaptive weighting + confidence calibration + biased-wheel detection
// ============================================================================

export class PredictionEngine {
  constructor(historicalData = []) {
    this.history = historicalData;
    // Default weights — adjusted continuously via adaptWeights()
    this.weights = {
      markov:    0.16,
      pattern:   0.16,
      streak:    0.10,
      bayesian:  0.12,
      cyclic:    0.10,
      recency:   0.10,
      bias:      0.10,
      sector:    0.08,
      neural:    0.08
    };
    this.minSamples = 5;
  }

  setHistory(data) { this.history = Array.isArray(data) ? data : []; }

  // ────────────────────────────────────────────────────────────────────
  // 1) VARIABLE-ORDER MARKOV CHAIN (1–5 order, with Laplace smoothing)
  // ────────────────────────────────────────────────────────────────────
  markovPredict(userSeq, type = 'even_odd') {
    const allSeq = [...this.history.map(d => d[type]), ...userSeq].filter(Boolean);
    if (allSeq.length < 4) return this._uniform(type);

    const transitions = {};
    for (let order = 1; order <= 5; order++) {
      for (let i = 0; i <= allSeq.length - order - 1; i++) {
        const key = allSeq.slice(i, i + order).join('');
        const next = allSeq[i + order];
        if (!transitions[key]) transitions[key] = {};
        transitions[key][next] = (transitions[key][next] || 0) + 1;
      }
    }
    let result = this._uniform(type);
    for (let order = 5; order >= 1; order--) {
      if (userSeq.length < order) continue;
      const ctx = userSeq.slice(-order).join('');
      const t = transitions[ctx];
      if (!t) continue;
      const total = Object.values(t).reduce((a, b) => a + b, 0);
      if (total >= 3) {
        const out = {};
        const keys = Object.keys(result);
        const k = keys.length;
        // Laplace smoothing α=0.5
        keys.forEach(key => {
          out[key] = ((t[key] || 0) + 0.5) / (total + 0.5 * k);
        });
        return out;
      }
    }
    return result;
  }

  // ────────────────────────────────────────────────────────────────────
  // 2) PATTERN MATCHING (suffix-tree style with fall-back)
  // ────────────────────────────────────────────────────────────────────
  patternPredict(userSeq, type = 'even_odd') {
    const allSeq = [...this.history.map(d => d[type]), ...userSeq].filter(Boolean);
    for (let pl = Math.min(userSeq.length, 8); pl >= 2; pl--) {
      const target = userSeq.slice(-pl).join('');
      const matches = this._zero(type);
      for (let i = 0; i <= allSeq.length - pl - 1; i++) {
        if (allSeq.slice(i, i + pl).join('') === target) {
          const next = allSeq[i + pl];
          if (matches[next] !== undefined) matches[next]++;
        }
      }
      const total = Object.values(matches).reduce((a, b) => a + b, 0);
      if (total >= 3) {
        const out = {};
        Object.keys(matches).forEach(k => out[k] = matches[k] / total);
        return out;
      }
    }
    return this._uniform(type);
  }

  // ────────────────────────────────────────────────────────────────────
  // 3) STREAK / GAMBLER'S BREAK
  // ────────────────────────────────────────────────────────────────────
  streakPredict(userSeq, type = 'even_odd') {
    if (!userSeq.length) return this._uniform(type);
    const last = userSeq[userSeq.length - 1];
    let streak = 1;
    for (let i = userSeq.length - 2; i >= 0; i--) {
      if (userSeq[i] === last) streak++; else break;
    }
    const breakProb = Math.min(0.50 + streak * 0.06, 0.82);
    const out = this._uniform(type);
    Object.keys(out).forEach(k => out[k] = (k === last) ? (1 - breakProb) / (Object.keys(out).length - 1) : breakProb / (Object.keys(out).length - 1) + (k !== last ? breakProb - breakProb / (Object.keys(out).length - 1) : 0));
    // simpler binary version (correct for E/O & R/B — both 2-class)
    const opp = type === 'color' ? (last === 'R' ? 'B' : 'R') : (last === 'E' ? 'O' : 'E');
    return { [opp]: breakProb, [last]: 1 - breakProb };
  }

  // ────────────────────────────────────────────────────────────────────
  // 4) BAYESIAN (long-term + recent prior, exponential decay)
  // ────────────────────────────────────────────────────────────────────
  bayesianPredict(userSeq, type = 'even_odd') {
    const allSeq = [...this.history.map(d => d[type]), ...userSeq].filter(Boolean);
    const counts = type === 'color' ? { R: 1, B: 1 } : { E: 1, O: 1 };
    allSeq.forEach((v, i) => {
      const w = Math.exp((i - allSeq.length) / 80);
      if (counts[v] !== undefined) counts[v] += w;
    });
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const result = {};
    Object.keys(counts).forEach(k => result[k] = counts[k] / total);
    // recent over-representation correction
    const recent = userSeq.slice(-10);
    const recCounts = this._zero(type);
    recent.forEach(v => { if (recCounts[v] !== undefined) recCounts[v]++; });
    const recTot = recent.length || 1;
    Object.keys(result).forEach(k => {
      const ratio = recCounts[k] / recTot;
      if (ratio > 0.7) result[k] *= 0.85;
      else if (ratio < 0.3) result[k] *= 1.15;
    });
    return this._normalize(result);
  }

  // ────────────────────────────────────────────────────────────────────
  // 5) CYCLIC DETECTION (auto-correlation 2..16)
  // ────────────────────────────────────────────────────────────────────
  cyclicPredict(userSeq, type = 'even_odd') {
    const allSeq = [...this.history.map(d => d[type]), ...userSeq].filter(Boolean);
    let bestCycle = null, bestScore = 0;
    for (let cycle = 2; cycle <= 16; cycle++) {
      if (allSeq.length < cycle * 4) continue;
      let m = 0, t = 0;
      for (let i = cycle; i < allSeq.length; i++) {
        if (allSeq[i] === allSeq[i - cycle]) m++;
        t++;
      }
      const score = m / t;
      if (score > bestScore && score > 0.56) { bestScore = score; bestCycle = cycle; }
    }
    const out = this._uniform(type);
    if (bestCycle !== null) {
      const predicted = allSeq[allSeq.length - bestCycle];
      Object.keys(out).forEach(k => out[k] = (1 - bestScore) / (Object.keys(out).length - 1));
      out[predicted] = bestScore;
    }
    return out;
  }

  // ────────────────────────────────────────────────────────────────────
  // 6) RECENCY MODEL (last-N momentum, exponential weighted)
  // ────────────────────────────────────────────────────────────────────
  recencyPredict(userSeq, type = 'even_odd') {
    const window = userSeq.slice(-15);
    if (!window.length) return this._uniform(type);
    const counts = this._zero(type);
    window.forEach((v, i) => {
      if (counts[v] !== undefined) {
        const w = Math.pow(1.18, i); // newer = higher weight
        counts[v] += w;
      }
    });
    return this._normalize(counts);
  }

  // ────────────────────────────────────────────────────────────────────
  // 7) BIAS DETECTION (chi-square style — favors persistent imbalance)
  // ────────────────────────────────────────────────────────────────────
  biasPredict(userSeq, type = 'even_odd') {
    const allSeq = [...this.history.map(d => d[type]), ...userSeq].filter(Boolean);
    if (allSeq.length < 50) return this._uniform(type);
    const counts = this._zero(type);
    allSeq.forEach(v => { if (counts[v] !== undefined) counts[v]++; });
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    // chi-square for 2-class
    const expected = total / 2;
    const chi = Object.values(counts).reduce((s, c) => s + Math.pow(c - expected, 2) / expected, 0);
    // p-value approx: chi>3.84 is significant at 95%
    if (chi < 2.5) return this._uniform(type);
    const out = {};
    Object.keys(counts).forEach(k => out[k] = counts[k] / total);
    return out;
  }

  // ────────────────────────────────────────────────────────────────────
  // 8) SECTOR ANALYSIS (uses raw number when available — wheel sectors)
  // ────────────────────────────────────────────────────────────────────
  sectorPredict(userSeq, type = 'even_odd') {
    // Build sector lookups from numbers in history
    const numHist = this.history.filter(h => typeof h.number === 'number');
    if (numHist.length < 50) return this._uniform(type);
    // European wheel order — adjacent sectors
    const wheel = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
    const last5 = numHist.slice(-5);
    if (last5.length < 5) return this._uniform(type);
    // hot zones (last 50 spins)
    const recent = numHist.slice(-50);
    const heat = new Array(37).fill(0);
    recent.forEach(d => { if (typeof d.number === 'number' && d.number >= 0 && d.number <= 36) heat[d.number]++; });
    // For each wheel position, sum heat of ±2 neighbors
    const sectorHeat = new Array(37).fill(0);
    wheel.forEach((n, idx) => {
      let s = 0;
      for (let off = -2; off <= 2; off++) {
        const pos = (idx + off + wheel.length) % wheel.length;
        s += heat[wheel[pos]];
      }
      sectorHeat[n] = s;
    });
    // Project onto 2-class
    const out = this._zero(type);
    sectorHeat.forEach((s, n) => {
      if (n === 0) return;
      const eoVal = n % 2 === 0 ? 'E' : 'O';
      const colVal = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(n) ? 'R' : 'B';
      const v = type === 'color' ? colVal : eoVal;
      if (out[v] !== undefined) out[v] += s;
    });
    return this._normalize(out);
  }

  // ────────────────────────────────────────────────────────────────────
  // 9) NEURAL-WEIGHTED (mini one-layer logistic on hand-crafted features)
  // ────────────────────────────────────────────────────────────────────
  neuralPredict(userSeq, type = 'even_odd') {
    if (userSeq.length < 5) return this._uniform(type);
    const keys = type === 'color' ? ['R','B'] : ['E','O'];
    // Features: ratio last 5, ratio last 10, current streak length+sign, alternation rate, parity of length
    const last5 = userSeq.slice(-5);
    const last10 = userSeq.slice(-10);
    const ratio5 = last5.filter(x => x === keys[0]).length / last5.length;
    const ratio10 = last10.filter(x => x === keys[0]).length / last10.length;
    let streak = 1, last = userSeq[userSeq.length - 1];
    for (let i = userSeq.length - 2; i >= 0; i--) {
      if (userSeq[i] === last) streak++; else break;
    }
    const streakSign = last === keys[0] ? 1 : -1;
    let alt = 0;
    for (let i = 1; i < userSeq.length; i++) if (userSeq[i] !== userSeq[i-1]) alt++;
    const altRate = alt / Math.max(userSeq.length - 1, 1);

    // Hand-tuned logistic weights (favoring mean-reversion + alternation)
    const z =
       1.4 * (0.5 - ratio5)             // mean reversion last 5
     + 0.9 * (0.5 - ratio10)            // mean reversion last 10
     - 0.6 * (streakSign * Math.min(streak / 6, 1)) // long streak ⇒ break
     + 0.5 * (altRate - 0.5);            // strong alternation continues
    const probKey0 = 1 / (1 + Math.exp(-z * 1.3));
    return { [keys[0]]: probKey0, [keys[1]]: 1 - probKey0 };
  }

  // ────────────────────────────────────────────────────────────────────
  // ENSEMBLE — weighted soft-voting + confidence calibration
  // ────────────────────────────────────────────────────────────────────
  predict(userSeq, type = 'even_odd') {
    if (!userSeq || userSeq.length < this.minSamples) {
      return {
        prediction: null,
        confidence: 0,
        probabilities: this._uniform(type),
        models: {},
        calibrated: 0,
        sampleSize: this.history.length
      };
    }

    const models = {
      markov:   this.markovPredict(userSeq, type),
      pattern:  this.patternPredict(userSeq, type),
      streak:   this.streakPredict(userSeq, type),
      bayesian: this.bayesianPredict(userSeq, type),
      cyclic:   this.cyclicPredict(userSeq, type),
      recency:  this.recencyPredict(userSeq, type),
      bias:     this.biasPredict(userSeq, type),
      sector:   this.sectorPredict(userSeq, type),
      neural:   this.neuralPredict(userSeq, type)
    };

    const final = this._zero(type);
    Object.keys(models).forEach(m => {
      const p = models[m] || {};
      Object.keys(final).forEach(k => {
        final[k] += (p[k] !== undefined ? p[k] : 1 / Object.keys(final).length) * (this.weights[m] || 0);
      });
    });

    const norm = this._normalize(final);
    const prediction = Object.keys(norm).reduce((a, b) => norm[a] > norm[b] ? a : b);
    const rawConf = norm[prediction];

    // Confidence calibration based on training data size + model agreement
    const agreement = this._modelAgreement(models, prediction);
    const dataFactor = Math.min(this.history.length / 500, 1);
    const calibrated = rawConf * (0.65 + 0.20 * agreement + 0.15 * dataFactor);

    return {
      prediction,
      confidence: Math.round(calibrated * 10000) / 100,
      rawConfidence: Math.round(rawConf * 10000) / 100,
      probabilities: norm,
      models,
      agreement: Math.round(agreement * 100),
      sampleSize: this.history.length
    };
  }

  // Adaptive weight learning from outcome log
  adaptWeights(predictionLog) {
    if (!predictionLog || predictionLog.length < 10) return;
    const acc = {};
    Object.keys(this.weights).forEach(k => acc[k] = 0.001);
    predictionLog.forEach(entry => {
      Object.keys(acc).forEach(m => {
        const probs = (entry.models && entry.models[m]) || {};
        if (Object.keys(probs).length === 0) return;
        const top = Object.keys(probs).reduce((a, b) => probs[a] > probs[b] ? a : b, null);
        if (top === entry.actual) acc[m]++;
      });
    });
    const total = Object.values(acc).reduce((a, b) => a + b, 0) || 1;
    Object.keys(this.weights).forEach(k => {
      this.weights[k] = (acc[k] / total) * 0.6 + this.weights[k] * 0.4;
    });
    const wSum = Object.values(this.weights).reduce((a, b) => a + b, 0) || 1;
    Object.keys(this.weights).forEach(k => this.weights[k] /= wSum);
  }

  // ───── helpers ─────
  _uniform(type) { return type === 'color' ? { R: 0.5, B: 0.5 } : { E: 0.5, O: 0.5 }; }
  _zero(type)    { return type === 'color' ? { R: 0,   B: 0   } : { E: 0,   O: 0   }; }
  _normalize(o)  {
    const s = Object.values(o).reduce((a, b) => a + b, 0) || 1;
    const r = {}; Object.keys(o).forEach(k => r[k] = o[k] / s); return r;
  }
  _modelAgreement(models, target) {
    let agree = 0, total = 0;
    Object.values(models).forEach(p => {
      if (!p || Object.keys(p).length === 0) return;
      const top = Object.keys(p).reduce((a, b) => p[a] > p[b] ? a : b);
      total++;
      if (top === target) agree++;
    });
    return total ? agree / total : 0;
  }
}
