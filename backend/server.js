const express = require("express");

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(process.cwd()));

// TikZJax will be loaded when the server starts
let load;
let tex;
let dvi2svg;


// ==================================================
// CLEAN TIKZ / LATEX CODE
// ==================================================

function cleanTikZ(input) {
    let code = input;

    // Remove \documentclass
    code = code.replace(
        /\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/g,
        ""
    );

    // Remove \usepackage{tikz}
    code = code.replace(
        /\\usepackage(?:\[[^\]]*\])?\{tikz\}/g,
        ""
    );

    // Remove \usetikzlibrary{arrows.meta}
    code = code.replace(
        /\\usetikzlibrary\{arrows\.meta\}/g,
        ""
    );

    // Remove \begin{document}
    code = code.replace(
        /\\begin\{document\}/g,
        ""
    );

    // Remove \end{document}
    code = code.replace(
        /\\end\{document\}/g,
        ""
    );

    return code.trim();
}


// ==================================================
// HEALTH CHECK
// ==================================================

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        message: "TikZ backend is running"
    });
});


// ==================================================
// TIKZ RENDERING ENDPOINT
// ==================================================

app.post("/api/render-tikz", async (req, res) => {
    try {
        const tikz = req.body.tikz;

        console.log("\n==============================");
        console.log("Received TikZ:");
        console.log(tikz);
        console.log("==============================");


        // Check if anything was provided
        if (!tikz || !tikz.trim()) {
            return res.status(400).json({
                success: false,
                error: "No TikZ code was provided."
            });
        }


        // ==================================================
        // CLEAN THE USER'S CODE
        // ==================================================

        const cleanedTikz = cleanTikZ(tikz);

        console.log("\n==============================");
        console.log("Cleaned TikZ:");
        console.log(cleanedTikz);
        console.log("==============================");


        // ==================================================
        // BUILD A COMPLETE LATEX DOCUMENT
        // ==================================================

        const source = String.raw`
\usepackage{tikz}
\usetikzlibrary{arrows.meta}

\begin{document}

${cleanedTikz}

\end{document}
`;


        console.log("\nSource sent to TikZJax:");
        console.log(source);
        console.log("==============================");

        console.log("Starting TikZ rendering...");


        // ==================================================
        // CONVERT LATEX → DVI
        // ==================================================

        const dvi = await tex(source, {
            showConsole: true
        });


        // ==================================================
        // CONVERT DVI → SVG
        // ==================================================

        const svg = await dvi2svg(dvi);


        console.log("TikZ rendering SUCCESS!");


        // Send SVG back to webpage
        res.json({
            success: true,
            svg: svg
        });


    } catch (error) {

        console.error("\n===== TIKZ ERROR =====");
        console.error(error);
        console.error("======================\n");

        res.status(500).json({
            success: false,
            error: error.message || "TikZ rendering failed."
        });
    }
});


// ==================================================
// LOAD TIKZJAX, THEN START SERVER
// ==================================================

async function startServer() {
    try {

        console.log("Loading TikZJax...");

        const tikzjax = await import("node-tikzjax");

        load = tikzjax.load;
        tex = tikzjax.tex;
        dvi2svg = tikzjax.dvi2svg;

        await load();

        console.log("TikZJax loaded.");


        app.listen(PORT, () => {

            console.log(
                `Assignment Marker running at http://localhost:${PORT}`
            );

        });

    } catch (error) {

        console.error("Failed to start server:");
        console.error(error);

    }
}

startServer();