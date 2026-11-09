export default {
  frs: "EXPERIMENTS",
  viewport: { width: 1024, height: 576 },
  fps: 12,
  gifWidth: 640,
  gifFps: 10,
  maxMb: 3,
  scenes: [
    {
      id: "open-draft", from: "experiments", title: "Open a draft", duration: 3,
      timeline: [
        { at: 0.5, click: "text=New experiment" },
        { at: 1.5, until: 2.8, note: "#experiment-name", text: "Name your draft" },
      ],
    },
    {
      id: "back-to-list", from: "experiments", title: "Return to the list", duration: 3,
      timeline: [
        { at: 0.5, click: "text=New experiment" },
        { at: 1.5, click: "text=Cancel" },
        { at: 2, until: 2.9, note: "text=Long-context summarization", text: "Back to the experiment list" },
      ],
    },
  ],
};
