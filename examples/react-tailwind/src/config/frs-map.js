/**
 * Requirement regions for the demo. Business data lives in the host project;
 * the toolkit only knows the shape: { key, title, status, routes }.
 */
export const ROUTES = {
  overview: "/overview",
  experiments: "/experiments",
  reviews: "/reviews",
  uiSpec: "/ui-spec",
};

export const FRS_REGISTRY = [
  { key: "OVERVIEW", title: "Workspace overview", status: "confirmed", routes: [ROUTES.overview] },
  { key: "EXPERIMENTS", title: "Experiments", status: "confirmed", routes: [ROUTES.experiments] },
  { key: "REVIEWS", title: "Review queue", status: "in_dev", routes: [ROUTES.reviews] },
  { key: "UI_SPEC", title: "UI spec", status: "accepting", routes: [ROUTES.uiSpec] },
];
