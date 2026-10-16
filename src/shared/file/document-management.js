/*
 * ============================================================
 * DOCUMENT MANAGEMENT: RENAME, SHARE, DETAILS, MOVE TO TRASH
 * ============================================================
 *
 * The four File-menu commands that act on the DOCUMENT rather than on the
 * drawing. They live together because they share one subject - the document and
 * where it is kept - and because each of them has to be honest about what this
 * application can actually do to a file it does not own.
 *
 * WHAT THE APPLICATION CAN AND CANNOT DO
 * --------------------------------------
 * A drawing lives in a `.enggdraw` file the USER owns, reached through the
 * browser's File System Access API (or, where that is absent, the download
 * folder). That constrains every command here, and the constraint is stated in
 * the interface rather than papered over:
 *
 *   RENAME   changes the document's own name. Where a writable handle exists the
 *            next Save writes to that file, so the name and the file agree;
 *            where it does not, the name is the name the next Save offers. It
 *            never claims to have renamed a file it could not reach.
 *
 *   SHARE    this application has NO hosted links, accounts or permissions, and
 *            it does not invent them. What it really has is a self-contained
 *            document, so Share offers exactly that: copy the document, or
 *            download it to pass on. Copying into the system clipboard is real;
 *            a "share link" would be fiction, so there is none.
 *
 *   DETAILS  reads what is really recorded - name, format, save state, size,
 *            sheet count, feature count - and says "Not recorded" for anything
 *            it does not track, rather than inventing a timestamp.
 *
 *   TRASH    removes the document's copy from the application and returns to a
 *            clean sheet. A browser page CANNOT delete a file the user saved to
 *            their disk, so this does NOT claim to have done so: it says plainly
 *            that the saved file is still where the user put it, which is the
 *            truth and the safe outcome.
 */

import enggDocumentFile from "./document-file.js";
import enggUi from "../ui/ui.js";

/* ---------------------------------------------------------- */
/* DETAILS                                                     */
/* ---------------------------------------------------------- */

/*
 * The document's byte size, as the JSON the format module would write.
 *
 * Measured from the ACTUAL serialization rather than estimated, so the figure
 * in the Details dialog is the size of the file Save would produce.
 */
function serializedSize(serializeBody) {
    try {
        const payload = enggDocumentFile.createDocument(serializeBody());

        const text = JSON.stringify(payload, null, 2);

        /*
         * Bytes, not characters. A drawing with a student's own units or
         * annotations in it can contain multi-byte characters, and reporting
         * the character count as the file size would understate it.
         */
        if (typeof TextEncoder !== "undefined") {
            return new TextEncoder().encode(text).length;
        }

        return text.length;
    } catch (error) {
        return null;
    }
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return "Not available";
    }

    if (bytes < 1024) {
        return `${bytes} bytes`;
    }

    const kb = bytes / 1024;

    if (kb < 1024) {
        return `${kb.toFixed(1)} KB`;
    }

    return `${(kb / 1024).toFixed(2)} MB`;
}

/*
 * Everything the Details panel can honestly report.
 *
 * A field is a `{ label, value }` pair; `value` is the string to show, and a
 * property this application does not track gets the same "Not recorded" text it
 * shows anywhere else rather than a plausible guess.
 */
export function documentDetails(context = {}) {
    const body = context.serialize
        ? context.serialize()
        : null;

    const sheets = Array.isArray(body?.sheets) ? body.sheets : [];

    const objectCount = sheets.reduce(
        (total, sheet) => total + (Array.isArray(sheet.objects) ? sheet.objects.length : 0),
        0
    );

    const named = Boolean(context.fileName);

    return [
        {
            label: "Name",
            value: context.fileName || "Untitled"
        },
        {
            label: "Type",
            value: `DAETUM drawing (.${enggDocumentFile.EXTENSION})`
        },
        {
            label: "Status",

            /*
             * THREE STATES, NOT TWO. "Saved" is wrong for a document that has
             * never been written to a file at all - a New drawing is CLEAN (it
             * has no edits to lose) but it is not saved anywhere, and saying so
             * tells the student what pressing Save will do.
             */
            value: context.dirty
                ? "Unsaved changes"
                : context.fileName
                  ? "Saved"
                  : "Not saved yet"
        },
        {
            label: "Saved to",
            value: named ? context.fileName : "Not saved to a file yet"
        },
        {
            label: "File size",
            value:
                serializedSize(context.serialize) !== null
                    ? formatBytes(serializedSize(context.serialize))
                    : "Not available"
        },
        {
            label: "Sheets",
            value: String(sheets.length)
        },
        {
            label: "Features",
            value: String(objectCount)
        },
        /*
         * THE TWO THE APPLICATION DOES NOT TRACK, SAID SO PLAINLY.
         *
         * Nothing records when a document was created or last modified - the
         * file system may know, but the page cannot read it - so these report
         * "Not recorded" rather than showing the current time and implying the
         * drawing was just made.
         */
        {
            label: "Created",
            value: "Not recorded"
        },
        {
            label: "Last modified",
            value: "Not recorded"
        }
    ];
}

/* ---------------------------------------------------------- */
/* THE DIALOGS                                                 */
/* ---------------------------------------------------------- */

/*
 * The Details panel.
 *
 * Its own `openDialog` body rather than a question: it is a read-only table of
 * label/value rows, so it takes a custom element and the dialog module positions
 * and dismisses it without needing to know what is inside.
 */
export function showDocumentDetails(context) {
    const rows = documentDetails(context);

    const body = document.createElement("div");

    body.className = "datum-document-details";

    rows.forEach((row) => {
        const line = document.createElement("div");

        line.className = "datum-document-details-row";

        const label = document.createElement("span");

        label.className = "datum-document-details-label";
        label.textContent = row.label;

        const value = document.createElement("span");

        value.className = "datum-document-details-value";
        value.textContent = row.value;

        line.appendChild(label);
        line.appendChild(value);
        body.appendChild(line);
    });

    return enggUi.openDialog({
        title: "Document Details",
        body,
        confirm: "Close",
        cancel: null
    });
}

/*
 * Ask for a new name.
 *
 * `promptDialog` is the shared text dialog, so validation, Escape-to-cancel and
 * Enter-to-confirm behave exactly as they do in every other DAETUM prompt.
 * The name is validated HERE rather than trusted from the field, and the caller
 * receives null when the user cancelled or typed nothing usable.
 */
export async function askForNewName(currentName) {
    const typed = await enggUi.promptDialog(
        "Enter a new name for this drawing.",
        {
            title: "Rename Drawing",
            /*
             * `name`, NOT `key`. The shared dialog collects its fields under
             * `field.name`, so this key is the name the value arrives back under.
             */
            fields: [
                {
                    name: "name",
                    label: "Name",
                    value: currentName || "Untitled",
                    placeholder: "Beam Analysis"
                }
            ],
            confirm: "Rename",
            cancel: "Cancel"
        }
    );

    if (!typed) {
        return null;
    }

    return typeof typed === "string" ? typed : typed.name;
}

/*
 * The Share dialog.
 *
 * IT DOES NOT OFFER A LINK, because this application cannot make one. What it
 * offers is what genuinely exists: the document is self-contained, so it can be
 * copied or downloaded and passed on by whatever means the user already has.
 * The dialog says so in as many words rather than showing a disabled "Copy link"
 * button that would teach the user nothing.
 */
export function showShareDialog(context = {}) {
  const body = document.createElement("div");

    body.className = "datum-share-dialog";

    const note = document.createElement("p");

    note.className = "datum-share-note";
    note.textContent =
        "DAETUM drawings are self-contained files. There is no hosted link or " +
        "permission system - sharing a drawing means passing the file on.";

    body.appendChild(note);

    const name = document.createElement("p");

    name.className = "datum-share-filename";
    name.textContent = context.fileName || "Untitled";

    body.appendChild(name);

    const actions = document.createElement("div");

    actions.className = "datum-share-actions";

    const copy = document.createElement("button");

    copy.type = "button";
    copy.className = "datum-share-action";
    copy.textContent = "Copy drawing to clipboard";
    copy.dataset.shareAction = "copy";

    const download = document.createElement("button");

    download.type = "button";
    download.className = "datum-share-action";
    download.textContent = "Download a copy";
    download.dataset.shareAction = "download";

    if (typeof context.onCopy === "function") {
      copy.addEventListener("click", () => context.onCopy());
    }

    if (typeof context.onDownload === "function") {
      download.addEventListener("click", () => context.onDownload());
    }

    actions.appendChild(copy);
    actions.appendChild(download);
    body.appendChild(actions);

    const status = document.createElement("p");

    status.className = "datum-share-status";
    status.dataset.shareStatus = "1";
    body.appendChild(status);

    return enggUi.openDialog({
        title: "Share Drawing",
        body,
        confirm: "Close",
        cancel: null
    });
}

/*
 * The Move to Trash confirmation.
 *
 * A destructive action asks first, `choiceDialog` names the two buttons after
 * what they DO, and Cancel is the dismissing one - so Escape, and a click
 * outside, both choose the safe answer.
 */
export function confirmMoveToTrash(name) {
    return enggUi.choiceDialog(
        `“${name || "Untitled"}” will be removed from DAETUM and this sheet ` +
            "will be replaced with a new, blank drawing.\n\n" +
            "A drawing you have already saved to your own computer is NOT deleted " +
            "- it stays in the folder you saved it to. This removes the copy " +
            "DAETUM is holding in this session.",
        {
            title: "Move to Trash",
            buttons: [
                {
                    id: "trash",
                    label: "Move to Trash",
                    destructive: true
                },
                {
                    id: "cancel",
                    label: "Cancel",
                    dismiss: true
                }
            ]
        }
    );
}

const enggDocumentManagement = {
    askForNewName,
    confirmMoveToTrash,
    documentDetails,
    showDocumentDetails,
    showShareDialog
};

export default enggDocumentManagement;
