import React from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import { portfolioPrinciples } from "../../../packages/core/src/index.js";
import "./style.css";

const h = React.createElement;

function App() {
  return h("main", { className: "shell" },
    h("header", { className: "topbar" },
      h("div", { className: "brand-mark" }, "LL"),
      h("div", null,
        h("p", { className: "eyebrow" }, "PORTFOLIO HEADQUARTERS"),
        h("h1", null, "Lost Legacies Live")
      ),
      h("span", { className: "status" }, "Foundation workspace")
    ),
    h("section", { className: "hero" },
      h("p", { className: "eyebrow" }, "ONE ECOSYSTEM · INDEPENDENT PRODUCTS"),
      h("h2", null, "Build together. Preserve what makes each project unique."),
      h("p", { className: "intro" }, "A shared starting point for architecture, contracts, and cross-platform development. Product repositories remain independently owned and deployable.")
    ),
    h("section", { className: "principles", "aria-label": "Operating principles" },
      ...portfolioPrinciples.map((principle, index) =>
        h("article", { className: "principle", key: principle.id },
          h("span", { className: "number" }, String(index + 1).padStart(2, "0")),
          h("div", null,
            h("h3", null, principle.title),
            h("p", null, principle.description)
          )
        )
      )
    ),
    h("footer", null, "Foundation scaffold · Product integrations require reviewed contracts and verified source ownership.")
  );
}

createRoot(document.getElementById("root")).render(h(App));
