export default {
  frame: "window",
  fps: 24,
  gifWidth: 960,
  gifFps: 15,
  maxMb: 5,
  scenes: [
    {
      id: "overview",
      title: "Feature overview",
      route: "/",
      duration: 4,
      timeline: [{ at: 1, until: 3, note: "h1", text: "What changed" }],
    },
  ],
};
