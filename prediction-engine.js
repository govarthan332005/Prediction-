// ============================================================================
// PREDICTION ENGINE — 5-Model Ensemble (Markov + Pattern + Streak + Bayesian + Cyclic)
// Self-contained copy for the Admin app (used in Test-Predict tab).
// ============================================================================

export class PredictionEngine {
  constructor(historicalData = []) {
    this.history = historicalData;
    this.weights = {
      markov: 0.25,
      pattern: 0.25,
      streak: 0.15,
      bayesian: 0.20,
      cyclic: 0.15
    };
  }

  setHistory(data) { this.history = data; }

  // ---------------- MARKOV CHAIN (variable order 1-4) ----------------
  markovPredict(userSeq, type = 'even_odd') {
    const allSeq = [...this.history.map(d => d[type]), ...userSeq].filter(Boolean);
    const transitions = {};
    for (let order = 1; order <= 4; order++) {
      for (let i = 0; i < allSeq.length - order; i++) {
        const key = allSeq.slice(i, i + order).join('');
        const next = allSeq[i + order];
        if (!transitions[key]) transitions[key] = {};
        transitions[key][next] = (transitions[key][next] || 0) + 1;
      }
    }
    let probs = type === 'color' ? { R: 0.5, B: 0.5 } : { E: 0.5, O: 0.5 };
    for (let order = 4; order >= 1; order--) {
      if (userSeq.length < order) continue;
      const context = userSeq.slice(-order).join('');
      if (transitions[context]) {
        const t = transitions[context];
        const total = Object.values(t).reduce((a, b) => a + b, 0);
        if (total >= 3) {
          const result = {};
          Object.keys(probs).forEach(k => { result[k] = (t[k] || 0) / total; });
          Object.keys(result).forEach(k => { result[k] = result[k] * 0.9 + 0.05; });
          return result;
        }
      }
    }
    return probs;
  }

  patternPredict(userSeq, type = 'even_odd') {
    const allSeq = [...this.history.map(d => d[type]), ...userSeq].filter(Boolean);
    const patternLen = Math.min(userSeq.length, 6);
    const target = userSeq.slice(-patternLen).join('');
    const matches = type === 'color' ? { R: 0, B: 0 } : { E: 0, O: 0 };
    for (let i = 0; i <= allSeq.length - patternLen - 1; i++) {
      const candidate = allSeq.slice(i, i + patternLen).join('');
      if (candidate === target) {
        const next = allSeq[i + patternLen];
        if (matches[next] !== undefined) matches[next]++;
      }
    }
    const total = Object.values(matches).reduce((a, b) => a + b, 0);
    if (total === 0) {
      if (patternLen > 2) return this.patternPredictShort(userSeq, type, patternLen - 1);
      return type === 'color' ? { R: 0.5, B: 0.5 } : { E: 0.5, O: 0.5 };
    }
    const result = {};
    Object.keys(matches).forEach(k => { result[k] = matches[k] / total; });
    return result;
  }

  patternPredictShort(userSeq, type, len) {
    const allSeq = [...this.history.map(d => d[type]), ...userSeq].filter(Boolean);
    const target = userSeq.slice(-len).join('');
    const matches = type === 'color' ? { R: 0, B: 0 } : { E: 0, O: 0 };
    for (let i = 0; i <= allSeq.length - len - 1; i++) {
      const candidate = allSeq.slice(i, i + len).join('');
      if (candidate === target) {
        const next = allSeq[i + len];
        if (matches[next] !== undefined) matches[next]++;
      }
    }
    const total = Object.values(matches).reduce((a, b) => a + b, 0);
    if (total === 0) return type === 'color' ? { R: 0.5, B: 0.5 } : { E: 0.5, O: 0.5 };
    const result = {};
    Object.keys(matches).forEach(k => result[k] = matches[k] / total);
    return result;
  }

  streakPredict(userSeq, type = 'even_odd') {
    const last = userSeq[userSeq.length - 1];
    let streak = 1;
    for (let i = userSeq.length - 2; i >= 0; i--) {
      if (userSeq[i] === last) streak++;
      else break;
    }
    const breakProb = Math.min(0.5 + streak * 0.08, 0.85);
    const opposite = type === 'color' ? (last === 'R' ? 'B' : 'R') : (last === 'E' ? 'O' : 'E');
    const result = {};
    result[opposite] = breakProb;
    result[last] = 1 - breakProb;
    return result;
  }

  bayesianPredict(userSeq, type = 'even_odd') {
    const allSeq = [...this.history.map(d => d[type]), ...userSeq].filter(Boolean);
    const counts = type === 'color' ? { R: 1, B: 1 } : { E: 1, O: 1 };
    allSeq.forEach((v, i) => {
      const weight = Math.exp((i - allSeq.length) / 50);
      if (counts[v] !== undefined) counts[v] += weight;
    });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const result = {};
    Object.keys(counts).forEach(k => result[k] = counts[k] / total);

    const recentCounts = type === 'color' ? { R: 0, B: 0 } : { E: 0, O: 0 };
    userSeq.forEach(v => { if (recentCounts[v] !== undefined) recentCounts[v]++; });
    const recTotal = userSeq.length || 1;
    Object.keys(result).forEach(k => {
      const recRatio = recentCounts[k] / recTotal;
      if (recRatio > 0.7) result[k] *= 0.85;
      else if (recRatio < 0.3) result[k] *= 1.15;
    });
    const sum = Object.values(result).reduce((a, b) => a + b, 0) || 1;
    Object.keys(result).forEach(k => result[k] /= sum);
    return result;
  }

  cyclicPredict(userSeq, type = 'even_odd') {
    const allSeq = [...this.history.map(d => d[type]), ...userSeq].filter(Boolean);
    const result = type === 'color' ? { R: 0.5, B: 0.5 } : { E: 0.5, O: 0.5 };
    let bestCycle = null, bestScore = 0;
    for (let cycle = 2; cycle <= 12; cycle++) {
      if (allSeq.length < cycle * 3) continue;
      let matches = 0, total = 0;
      for (let i = cycle; i < allSeq.length; i++) {
        if (allSeq[i] === allSeq[i - cycle]) matches++;
        total++;
      }
      const score = matches / total;
      if (score > bestScore && score > 0.55) { bestScore = score; bestCycle = cycle; }
    }
    if (bestCycle !== null) {
      const predicted = allSeq[allSeq.length - bestCycle];
      if (result[predicted] !== undefined) {
        Object.keys(result).forEach(k => result[k] = (1 - bestScore) / (Object.keys(result).length - 1));
        result[predicted] = bestScore;
      }
    }
    return result;
  }

  predict(userSeq, type = 'even_odd') {
    if (!userSeq || userSeq.length < 3) {
      return {
        prediction: null, confidence: 0,
        probabilities: type === 'color' ? { R: 0.5, B: 0.5 } : { E: 0.5, O: 0.5 },
        models: {}
      };
    }
    const models = {
      markov: this.markovPredict(userSeq, type),
      pattern: this.patternPredict(userSeq, type),
      streak: this.streakPredict(userSeq, type),
      bayesian: this.bayesianPredict(userSeq, type),
      cyclic: this.cyclicPredict(userSeq, type)
    };
    const final = type === 'color' ? { R: 0, B: 0 } : { E: 0, O: 0 };
    Object.keys(models).forEach(model => {
      Object.keys(final).forEach(k => {
        final[k] += (models[model][k] || 0.5) * this.weights[model];
      });
    });
    const sum = Object.values(final).reduce((a, b) => a + b, 0) || 1;
    Object.keys(final).forEach(k => final[k] /= sum);
    const prediction = Object.keys(final).reduce((a, b) => final[a] > final[b] ? a : b);
    const confidence = final[prediction];
    return {
      prediction,
      confidence: Math.round(confidence * 10000) / 100,
      probabilities: final,
      models
    };
  }

  adaptWeights(predictionLog) {
    if (!predictionLog || predictionLog.length < 5) return;
    const accuracy = { markov: 0, pattern: 0, streak: 0, bayesian: 0, cyclic: 0 };
    predictionLog.forEach(entry => {
      Object.keys(accuracy).forEach(model => {
        const probs = (entry.models && entry.models[model]) || {};
        const pred = Object.keys(probs).reduce((a, b) => (probs[a] > probs[b] ? a : b), null);
        if (pred === entry.actual) accuracy[model]++;
      });
    });
    const total = Object.values(accuracy).reduce((a, b) => a + b, 0) || 1;
    Object.keys(this.weights).forEach(k => {
      this.weights[k] = (accuracy[k] / total) * 0.7 + this.weights[k] * 0.3;
    });
    const wSum = Object.values(this.weights).reduce((a, b) => a + b, 0) || 1;
    Object.keys(this.weights).forEach(k => this.weights[k] /= wSum);
  }
}
