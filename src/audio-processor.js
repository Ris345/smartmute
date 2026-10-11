class VADProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.threshold = 0.015;
    this.port.onmessage = (event) => {
      if (event.data.type === 'SET_THRESHOLD') {
        this.threshold = event.data.value;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    const channel = input[0];
    let sumOfSquares = 0;
    for (let i = 0; i < channel.length; i++) {
      sumOfSquares += channel[i] * channel[i];
    }
    const rms = Math.sqrt(sumOfSquares / channel.length);

    this.port.postMessage({ rms, isSpeech: rms > this.threshold });

    return true;
  }
}

registerProcessor('vad-processor', VADProcessor);
