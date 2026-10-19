function showTab(tabName, button) {
    document.querySelectorAll(".review-content").forEach(section => {
        section.classList.remove("active");
    });

    document.querySelectorAll(".tab").forEach(tab => {
        tab.classList.remove("active");
    });

    document.getElementById(tabName).classList.add("active");
    button.classList.add("active");
}

async function updateWriting() {
    let code = document.getElementById("writingCode").value;
    const output = document.getElementById("writingOutput");
    const documentMatch = code.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);

    if (documentMatch) {
        code = documentMatch[1].trim();
    }

    MathJax.typesetClear([output]);
    const hasMathDelimiters = /\\\[|\\\(|\$\$/.test(code);
    output.textContent = hasMathDelimiters ? code : `\\[${code}\\]`;
    await MathJax.typesetPromise([output]);
}

function previewImage(uploadId, imageId, messageId) {
    const upload = document.getElementById(uploadId);
    const image = document.getElementById(imageId);
    const message = document.getElementById(messageId);

    upload.addEventListener("change", () => {
        const file = upload.files[0];

        if (!file) return;

        image.src = URL.createObjectURL(file);
        image.style.display = "block";
        message.style.display = "none";
    });
}

previewImage("writingImageUpload", "writingImage", "writingImageMessage");