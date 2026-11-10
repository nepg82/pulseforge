// Background-capable metronome: keep the timer outside the page's main thread.
let timer = null;
self.onmessage = event => {
  if (event.data === "start") {
    if (timer !== null) clearInterval(timer);
    timer = setInterval(() => self.postMessage("tick"), 25);
  } else if (event.data === "stop") {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }
};
