(function () {
	var LIVE_FILE = "annotool_live.json";
	var PRED_FILE = "annotool_predictions.json";
	var STATUS_FILE = "live_trainer_status.json";
	var DB_NAME = "annotool-livesync";
	var DB_STORE = "kv";
	var DEBOUNCE_MS = 2500;
	var POLL_MS = 2000;

	var dirHandle = null;
	var savedHandle = null;
	var connected = false;
	var dbp = null;
	var timer = null;
	var pollTimer = null;
	var followTimer = null;
	var chain = Promise.resolve();
	var pollChain = Promise.resolve();
	var flushing = false;
	var lastBody = "";
	var predictions = null;
	var predText = "";
	var predWarned = "";
	var statusText = null;
	var trainerDoc = null;
	var trainerBad = false;
	var prepareShown = false;
	var prepareLatched = false;
	var readyToastAt = 0;
	var dismiss = false;
	var shown = [];
	var reviewed = [];
	var rejected = {};
	var storageReady = false;
	var userCleared = false;
	var navReviews = 0;
	var allowEmptyWrite = false;
	var liveReviewedAdopted = false;
	var hydratedImages = null;
	var hydratedProject = "";
	var drawnFor = "";
	var boardDirty = false;
	var bareNoticeProject = "";
	var bareNoticeNames = [];
	var modelChoice = "continue";
	var modelStored = false;
	var modelUiSig = "";
	var shownError = null;
	var dismissedError = null;
	var mapDrag = null;
	var mapSig = "";
	var MAP_OPEN_KEY = "annotool.mapPanelOpen";
	var MAP_POS_KEY = "annotool.mapPanelPos";
	var reviewedProject = null;
	var reviewedLoaded = false;
	var skipLeave = false;
	var clearingPredictions = false;

	function supported() {
		return !!(window.showDirectoryPicker && window.indexedDB);
	}

	function currentProject() {
		if (reviewedLoaded && reviewedProject) return reviewedProject;
		if (typeof allAnnotations !== "undefined" && allAnnotations && allAnnotations.project) return allAnnotations.project;
		if (typeof prefs !== "undefined" && prefs && prefs.projectName) return prefs.projectName;
		return "";
	}

	function reviewKey() {
		return "annotool.reviewed:" + (reviewedProject || "_");
	}

	function saveReviewed() {
		try { localStorage.setItem(reviewKey(), JSON.stringify(reviewed)); } catch (e) {}
	}

	function rejectKey() {
		return "annotool.rejected:" + (reviewedProject || "_");
	}

	function saveRejected() {
		try { localStorage.setItem(rejectKey(), JSON.stringify(rejected)); } catch (e) {}
	}

	function loadRejected() {
		rejected = {};
		try {
			var raw = localStorage.getItem(rejectKey());
			var obj = raw ? JSON.parse(raw) : {};
			if (obj && typeof obj === "object" && Object.prototype.toString.call(obj) !== "[object Array]") rejected = obj;
		} catch (e) {}
	}

	function sameRejection(a, b) {
		return a && b && a.brand === b.brand && a.tpoint === b.tpoint && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
	}

	function mergeRejected(doc) {
		var name, list, i, entry, have, j, changed = false;
		if (!doc || !doc.rejected || typeof doc.rejected !== "object") return;
		for (name in doc.rejected) {
			if (!Object.prototype.hasOwnProperty.call(doc.rejected, name)) continue;
			list = doc.rejected[name];
			if (!list || !list.length) continue;
			if (!rejected[name]) rejected[name] = [];
			have = rejected[name];
			for (i = 0; i < list.length; i++) {
				entry = list[i];
				if (!entry) continue;
				for (j = 0; j < have.length; j++) if (sameRejection(have[j], entry)) break;
				if (j === have.length) { have.push(entry); changed = true; }
			}
		}
		if (changed) saveRejected();
	}

	function frameTotal() {
		var n = 0, key;
		if (typeof imIndices !== "undefined" && imIndices && imIndices.length) return imIndices.length;
		if (typeof imAll !== "undefined" && imAll) {
			for (key in imAll) if (Object.prototype.hasOwnProperty.call(imAll, key) && key) n++;
		}
		return n;
	}

	function annotationCount(images) {
		var n = 0, key;
		if (!images || typeof images !== "object") return 0;
		for (key in images) {
			if (!Object.prototype.hasOwnProperty.call(images, key) || !images[key]) continue;
			if (images[key].annotations && images[key].annotations.length) n++;
		}
		return n;
	}

	function reviewedNames(list) {
		var out = [], i, name;
		if (!list || !list.length) return out;
		for (i = 0; i < list.length; i++) {
			name = list[i];
			if (typeof name === "string" && name && out.indexOf(name) === -1) out.push(name);
		}
		return out;
	}

	function readStoredReviewed() {
		try {
			var raw = localStorage.getItem(reviewKey());
			var arr = raw ? JSON.parse(raw) : [];
			if (Object.prototype.toString.call(arr) !== "[object Array]") return [];
			return reviewedNames(arr);
		} catch (e) { return []; }
	}

	function unionReviewed(a, b) {
		return reviewedNames((a || []).concat(b || []));
	}

	function withoutBoxes(list) {
		var images, out = [], i, name, entry;
		images = (typeof allAnnotations !== "undefined" && allAnnotations && allAnnotations.images) || {};
		list = list || [];
		for (i = 0; i < list.length; i++) {
			name = list[i];
			entry = images[name];
			if (!entry || !entry.annotations || !entry.annotations.length) out.push(name);
		}
		return out;
	}

	function bareNoticeKey() {
		return "annotool.bareNotice:" + (currentProject() || "_");
	}

	function clearWarnedBare() {
		var images, drop = {}, kept = [], i, name, entry, has;
		for (i = 0; i < bareNoticeNames.length; i++) drop[bareNoticeNames[i]] = 1;
		images = (typeof allAnnotations !== "undefined" && allAnnotations && allAnnotations.images) || {};
		for (i = 0; i < reviewed.length; i++) {
			name = reviewed[i];
			entry = images[name];
			has = entry && entry.annotations && entry.annotations.length;
			if (drop[name] && !has) continue;
			kept.push(name);
		}
		reviewed = kept;
		bareNoticeNames = [];
		saveReviewed();
		flush(true);
	}

	function warnBareReviewed(names) {
		var project, n, nty;
		project = currentProject();
		names = names || [];
		if (!project || names.length < 15 || bareNoticeProject === project) return;
		try { if (sessionStorage.getItem(bareNoticeKey()) === "1") { bareNoticeProject = project; return; } } catch (e) {}
		bareNoticeProject = project;
		bareNoticeNames = names.slice();
		try { sessionStorage.setItem(bareNoticeKey(), "1"); } catch (e2) {}
		if (!window.Noty) return;
		n = names.length;
		nty = new Noty({
			type: "warning",
			theme: "mint",
			layout: "topRight",
			timeout: false,
			closeWith: ["click", "button"],
			text: "Βρέθηκαν " + n + " ελεγμένα frames χωρίς κουτιά · θα μετρηθούν ως negatives",
			buttons: [
				Noty.button("Καθάρισέ τα", "liveBareClear", function () {
					clearWarnedBare();
					nty.close();
				}, { id: "clearBareReviewed" })
			]
		});
		nty.show();
	}

	function loadReviewedList() {
		reviewed = readStoredReviewed();
	}

	function projectFamily() {
		var groups = null, i, g;
		if (typeof prefs !== "undefined" && prefs && prefs.groups && prefs.groups.length) groups = prefs.groups;
		else if (typeof allAnnotations !== "undefined" && allAnnotations && allAnnotations.prefs && allAnnotations.prefs.groups) groups = allAnnotations.prefs.groups;
		if (groups) {
			for (i = 0; i < groups.length; i++) {
				g = groups[i];
				if (g && String(g).replace(/^\s+|\s+$/g, "")) return String(g).replace(/^\s+|\s+$/g, "");
			}
		}
		return currentProject() || "";
	}

	function modelKey() {
		return "annotool.model:" + (reviewedProject || "_");
	}

	function resolvedChoice() {
		var fam;
		if (modelChoice.indexOf("from:") === 0) {
			fam = modelChoice.slice(5).replace(/^\s+|\s+$/g, "");
			return fam ? "from:" + fam : "continue";
		}
		return modelChoice === "new" ? "new" : "continue";
	}

	function resolvedFamily() {
		var fam;
		if (modelChoice.indexOf("from:") === 0) {
			fam = modelChoice.slice(5).replace(/^\s+|\s+$/g, "");
			if (fam) return fam;
		}
		return projectFamily();
	}

	function applyChoice(choice) {
		choice = String(choice || "");
		if (choice === "new" || choice === "continue" || choice.indexOf("from:") === 0) modelChoice = choice;
		else modelChoice = "continue";
	}

	function saveModel() {
		try {
			localStorage.setItem(modelKey(), JSON.stringify({ modelChoice: resolvedChoice(), modelFamily: resolvedFamily() }));
			modelStored = true;
		} catch (e) {}
	}

	function loadModel() {
		modelChoice = "continue";
		modelStored = false;
		modelUiSig = "";
		try {
			var raw = localStorage.getItem(modelKey());
			if (!raw) return;
			var obj = JSON.parse(raw);
			modelStored = true;
			if (obj && typeof obj.modelChoice === "string") applyChoice(obj.modelChoice);
		} catch (e) {}
	}

	function absorbModel(doc) {
		if (!doc || modelStored || typeof doc.modelChoice !== "string" || !doc.modelChoice) return;
		applyChoice(doc.modelChoice);
		saveModel();
	}

	function ensureReviewed() {
		var project = currentProject();
		var keep;
		if (reviewedLoaded && project === reviewedProject) return;
		if (reviewedLoaded) { saveReviewed(); saveRejected(); saveModel(); }
		keep = liveReviewedAdopted;
		reviewedProject = project;
		reviewedLoaded = true;
		if (!keep) {
			liveReviewedAdopted = false;
			reviewed = [];
		}
		loadRejected();
		loadModel();
	}

	function noteProject(name) {
		name = String(name || "").replace(/^\s+|\s+$/g, "");
		if (!name) return;
		if (typeof allAnnotations !== "undefined" && allAnnotations) allAnnotations.project = name;
		if (typeof prefs !== "undefined" && prefs) prefs.projectName = name;
		var changed = !reviewedLoaded || reviewedProject !== name;
		if (!changed) {
			if (connected) flush(true);
			return;
		}
		if (reviewedLoaded) { saveReviewed(); saveRejected(); saveModel(); }
		reviewedProject = name;
		reviewedLoaded = true;
		liveReviewedAdopted = false;
		reviewed = [];
		navReviews = 0;
		allowEmptyWrite = false;
		boardDirty = false;
		loadRejected();
		loadModel();
		skipLeave = true;
		window.__liveLeaving = "";
		clearShownPredictions();
		prepareShown = false;
		prepareLatched = false;
		readyToastAt = 0;
		hideWait();
		paintFramePredict();
		paintTrainer();
		if (predictionsApply()) showForCurrent();
		if (connected) return pullLiveState().then(function () { return flush(true); });
	}

	function addReviewed(name) {
		if (!name) return;
		ensureReviewed();
		if (reviewed.indexOf(name) === -1) reviewed.push(name);
		navReviews++;
		saveReviewed();
	}

	function removeReviewed(name) {
		if (!name) return;
		ensureReviewed();
		var i = reviewed.indexOf(name);
		if (i === -1) return;
		reviewed.splice(i, 1);
		saveReviewed();
	}

	function note(text) {
		if (window.Noty) new Noty({ type: "warning", theme: "mint", layout: "topRight", text: text, timeout: 1800 }).show();
	}

	function toast(text) {
		if (window.Noty) new Noty({ type: "success", theme: "mint", layout: "topRight", text: text, timeout: 2200 }).show();
	}

	function pick(obj, names) {
		var i, v;
		if (!obj) return null;
		for (i = 0; i < names.length; i++) {
			v = obj[names[i]];
			if (v !== undefined && v !== null && v !== "") return v;
		}
		return null;
	}

	function asNumber(v) {
		if (typeof v === "number" && isFinite(v)) return v;
		if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v);
		return null;
	}

	function asCount(v) {
		if (typeof v === "number" && isFinite(v)) return v;
		if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v);
		if (Object.prototype.toString.call(v) === "[object Array]") return v.length;
		if (v && typeof v === "object") return Object.keys(v).length;
		return null;
	}

	function normState(v) {
		var s = String(v == null ? "" : v).trim().toLowerCase();
		if (s === "training_family") return "training_family";
		if (s === "waiting_gpu" || s === "waiting-gpu") return "waiting_gpu";
		if (s === "training" || s === "train") return "training";
		if (s === "predicting" || s === "predict" || s === "inference") return "predicting";
		if (s === "idle" || s === "ready" || s === "waiting" || s === "done" || s === "") return "idle";
		if (s === "error" || s === "failed") return "error";
		return s;
	}

	function shortTime(v) {
		if (v == null || v === "") return "";
		var d, n = asNumber(v);
		if (typeof v === "number" || (typeof v === "string" && n != null && String(v).trim() === String(n))) {
			d = new Date(n < 1e12 ? n * 1000 : n);
		} else d = new Date(v);
		if (isNaN(d.getTime())) return String(v).replace("T", " ").slice(0, 16);
		var hh = d.getHours(), mm = d.getMinutes();
		return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
	}

	function formatMap(v) {
		var n = asNumber(v);
		if (n == null) return "";
		return "mAP " + n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
	}

	function predictionFrameCount(doc) {
		var n = doc ? asCount(pick(doc, ["predicted_frames", "predictedFrames", "frame_count", "frameCount", "n_frames", "frames"])) : null;
		if (n == null && doc && typeof doc.predictions === "number") n = doc.predictions;
		if (n == null && predictionsApply() && predictions.images) n = predictionKeysInFolder().length;
		return n;
	}

	function numericStem(value) {
		var s = stemOf(value);
		if (!/^\d+$/.test(s)) return null;
		return { n: parseInt(s, 10), raw: s };
	}

	function padFrame(n, width) {
		var s = String(n);
		while (s.length < width) s = "0" + s;
		return s;
	}

	function rangeText(from, to) {
		from = String(from);
		to = String(to);
		if (from === to) return "Προβλέψεις: frames " + from;
		return "Προβλέψεις: frames " + from + "–" + to;
	}

	function predictionCoverage() {
		var fromField = trainerDoc ? pick(trainerDoc, ["predicted_from", "predictedFrom"]) : null;
		var toField = trainerDoc ? pick(trainerDoc, ["predicted_to", "predictedTo"]) : null;
		var images, key, img, label, stem, num, width, min, max, names, i;
		if (fromField != null && toField != null) {
			return { from: String(fromField), to: String(toField), text: rangeText(fromField, toField), end: numericStem(toField) };
		}
		if (!predictionsApply() || !predictions.images) return null;
		images = predictions.images;
		width = 0;
		min = null;
		max = null;
		names = [];
		for (key in images) {
			if (!Object.prototype.hasOwnProperty.call(images, key) || !images[key]) continue;
			if (!keyInOpenFolder(key)) continue;
			img = images[key];
			label = img.imageName || key;
			stem = stemOf(label);
			names.push(stem);
			num = numericStem(stem);
			if (!num) continue;
			if (num.raw.length > width) width = num.raw.length;
			if (!min || num.n < min.n) min = num;
			if (!max || num.n > max.n) max = num;
		}
		if (min && max) {
			return {
				from: padFrame(min.n, width),
				to: padFrame(max.n, width),
				text: rangeText(padFrame(min.n, width), padFrame(max.n, width)),
				end: max
			};
		}
		if (!names.length) return null;
		names.sort();
		return { from: names[0], to: names[names.length - 1], text: rangeText(names[0], names[names.length - 1]), end: null };
	}

	function trainerPhrase(doc) {
		var state = normState(pick(doc, ["state", "status"]));
		var raw = pick(doc, ["state", "status"]);
		var cycle = pick(doc, ["cycle", "cycle_index", "cycleIndex"]);
		var count = predictionFrameCount(doc);
		if (state === "training_family") return "Ενιαίο μοντέλο…";
		if (state === "waiting_gpu") return "Αναμονή για κάρτα…";
		if (state === "training") return "Εκπαίδευση…" + (cycle != null ? " κύκλος " + cycle : "");
		if (state === "predicting") return "Προβλέψεις…";
		if (state === "error") return "σφάλμα";
		if (state === "idle" && count != null) return "Προβλέψεις έτοιμες: " + count + " frames";
		if (cycle != null && state === "idle") return "κύκλος " + cycle;
		if (raw != null && state !== "idle") return String(raw);
		return doc ? "αναμονή" : "";
	}

	function trainerProgress(doc) {
		var since = asNumber(pick(doc, ["reviewed_since_last_cycle", "reviewedSinceLastCycle", "reviewed_since", "reviewedSince", "since_last_cycle", "new_reviewed"]));
		var reviewed = asNumber(pick(doc, ["reviewed", "reviewed_count", "reviewedCount", "n_reviewed"]));
		var atLast = asNumber(pick(doc, ["reviewed_at_last_cycle", "reviewedAtLastCycle", "last_cycle_reviewed"]));
		var threshold = asNumber(pick(doc, ["threshold", "cycle_threshold", "cycleThreshold", "review_threshold", "next_threshold", "reviews_per_cycle"]));
		if (since == null && reviewed != null && atLast != null) since = Math.max(0, reviewed - atLast);
		if (since == null || threshold == null) return "";
		return since + "/" + threshold;
	}

	function statusForOpen(doc) {
		var tagged, open;
		if (!doc) return false;
		if (!Object.prototype.hasOwnProperty.call(doc, "project")) return true;
		if (doc.project == null) return true;
		tagged = String(doc.project).replace(/^\s+|\s+$/g, "");
		if (!tagged) return true;
		open = String(currentProject() || "");
		if (!open) return true;
		return tagged === open;
	}

	function namedProjectMatch(doc) {
		var tagged, open;
		if (!doc || doc.project == null) return false;
		tagged = String(doc.project).replace(/^\s+|\s+$/g, "");
		open = String(currentProject() || "");
		return !!(tagged && open && tagged === open);
	}

	function predictionsPresent() {
		return !!(predictionsApply() && predictions.images && Object.keys(predictions.images).length);
	}

	function hasPrepareKeys(doc) {
		if (!doc) return false;
		if (Object.prototype.hasOwnProperty.call(doc, "ready_for_user") || Object.prototype.hasOwnProperty.call(doc, "readyForUser")) return true;
		return pick(doc, ["predict_total", "predictTotal"]) != null;
	}

	function readyFlag(doc) {
		var ready = null;
		if (!doc) return false;
		if (Object.prototype.hasOwnProperty.call(doc, "ready_for_user")) ready = doc.ready_for_user;
		else if (Object.prototype.hasOwnProperty.call(doc, "readyForUser")) ready = doc.readyForUser;
		return ready === true || ready === 1 || ready === "true" || ready === "1";
	}

	function isReady(doc) {
		var state;
		if (!doc || !statusForOpen(doc)) return false;
		if (readyFlag(doc)) return true;
		state = normState(pick(doc, ["state", "status"]));
		return (state === "idle" || state === "training") && predictionsPresent();
	}

	function foreignProject(doc) {
		var tagged, open;
		if (!doc || !Object.prototype.hasOwnProperty.call(doc, "project") || doc.project == null) return false;
		tagged = String(doc.project).replace(/^\s+|\s+$/g, "");
		open = String(currentProject() || "");
		return !!(tagged && open && tagged !== open);
	}

	function trainerBusy(doc) {
		return normState(pick(doc, ["state", "status"])) !== "idle";
	}

	function shouldShowWait(doc) {
		var state;
		if (!connected || !doc || prepareLatched) return false;
		if (foreignProject(doc)) return trainerBusy(doc);
		if (!statusForOpen(doc) || isReady(doc)) return false;
		state = normState(pick(doc, ["state", "status"]));
		if (state === "training_family" || state === "waiting_gpu") return true;
		if (state !== "predicting") return false;
		if (!hasPrepareKeys(doc) && predictionsPresent()) return false;
		return true;
	}

	function epochNumbers(doc) {
		return {
			cur: asNumber(pick(doc, ["epoch", "current_epoch", "epoch_index", "epochIndex"])),
			total: asNumber(pick(doc, ["epochs", "epoch_total", "epochTotal", "num_epochs", "max_epochs", "n_epochs"]))
		};
	}

	function epochSuffix(doc) {
		var n = epochNumbers(doc);
		if (n.cur == null || n.total == null) return "";
		return " (epoch " + n.cur + "/" + n.total + ")";
	}

	function epochPct(doc) {
		var n = epochNumbers(doc);
		if (n.cur != null && n.total != null && n.total > 0) return Math.max(0, Math.min(100, (n.cur / n.total) * 100));
		return -1;
	}

	function statusUpdatedMs(doc) {
		var v = pick(doc, ["updated_at", "updatedAt"]);
		var n, d;
		if (v == null || v === "") return null;
		n = asNumber(v);
		if (typeof v === "number" || (typeof v === "string" && n != null && String(v).trim() === String(n))) {
			d = new Date(n < 1e12 ? n * 1000 : n);
		} else d = new Date(v);
		if (isNaN(d.getTime())) return null;
		return d.getTime();
	}

	function statusIsStale(doc) {
		var ms = statusUpdatedMs(doc);
		return ms != null && (Date.now() - ms) > 120000;
	}

	function shortProject(name) {
		var cut, cluster;
		name = String(name == null ? "" : name).replace(/\\/g, "/").replace(/^\s+|\s+$/g, "");
		cut = name.lastIndexOf("/");
		if (cut !== -1) name = name.slice(cut + 1);
		cluster = name.match(/^([^_]+_).+(-cluster_\d+)$/);
		if (cluster && name.length > 28) return cluster[1] + "…" + cluster[2];
		if (name.length <= 42) return name;
		return name.slice(0, 16) + "…" + name.slice(-14);
	}

	function waitHost() {
		return document.getElementById("box") || document.body;
	}

	function ensureWait() {
		var el = document.getElementById("liveWait");
		var host = waitHost();
		if (!el) {
			el = document.createElement("div");
			el.id = "liveWait";
			el.hidden = true;
			el.innerHTML = '<div class="liveWaitCard"><div class="liveWaitText"></div><div class="liveWaitTrack" hidden><i></i></div></div>';
			el.addEventListener("mousedown", stop);
			el.addEventListener("pointerdown", stop);
			el.addEventListener("click", stop);
		}
		if (el.parentNode !== host) host.appendChild(el);
		return el;
	}

	function hideWait() {
		var el = document.getElementById("liveWait");
		if (el) el.hidden = true;
	}

	function renderWait(doc) {
		var el = ensureWait();
		var state = normState(pick(doc, ["state", "status"]));
		var text = "Περίμενε";
		var track = el.querySelector(".liveWaitTrack");
		var fill = track.querySelector("i");
		var done, total, pct = null;
		if (foreignProject(doc)) {
			if (statusIsStale(doc)) text = "Ο trainer δεν απαντά";
			else {
				text = "Περίμενε… τελειώνω την εκπαίδευση από τον προηγούμενο φάκελο (" + shortProject(doc.project) + "), μετά θα τρέξει πρόβλεψη εδώ";
				pct = epochPct(doc);
			}
		} else if (state === "training_family") {
			text = "Περίμενε · εκπαιδεύεται το ενιαίο μοντέλο" + epochSuffix(doc);
			pct = epochPct(doc);
		} else if (state === "waiting_gpu") text = "Περίμενε · αναμονή για κάρτα γραφικών";
		else {
			done = asNumber(pick(doc, ["predicted_frames", "predictedFrames"]));
			total = asNumber(pick(doc, ["predict_total", "predictTotal"]));
			text = "Περίμενε · βγαίνουν προβλέψεις";
			if (done != null && total != null) {
				text += " (" + done + "/" + total + ")";
				if (total > 0) pct = Math.max(0, Math.min(100, (done / total) * 100));
			}
		}
		el.querySelector(".liveWaitText").textContent = text;
		track.classList.toggle("is-busy", pct != null && pct < 0);
		if (pct == null) track.hidden = true;
		else {
			track.hidden = false;
			fill.style.width = pct < 0 ? "" : (pct + "%");
		}
		el.hidden = false;
	}

	function forceReloadPredictions() {
		predText = "";
		return pollPredictions({ quiet: true });
	}

	function paintPrepare() {
		var doc = trainerDoc && !trainerBad ? trainerDoc : null;
		if (!connected) {
			hideWait();
			return;
		}
		if (shouldShowWait(doc)) {
			prepareShown = true;
			renderWait(doc);
			return;
		}
		hideWait();
		if (prepareShown && doc && isReady(doc)) {
			prepareShown = false;
			prepareLatched = true;
			readyToastAt = Date.now();
			toast("Έτοιμο · ξεκίνα");
			forceReloadPredictions();
			return;
		}
		if (doc && isReady(doc) && (namedProjectMatch(doc) || !Object.prototype.hasOwnProperty.call(doc, "project"))) prepareLatched = true;
	}

	function rawTrainerError(doc) {
		var err = pick(doc, ["last_error", "lastError", "error"]);
		if (err == null) return "";
		if (typeof err === "object") err = err.message || err.msg || "";
		err = String(err).replace(/^\s+|\s+$/g, "");
		if (!err || err === "null" || err === "none" || err === "None") return "";
		return err;
	}

	function greekTrainerError(raw) {
		var s = String(raw || "").toLowerCase();
		if (/cuda/.test(s) && /out of memory|out of mem|outofmemory|\boom\b/.test(s)) {
			return "Η κάρτα γραφικών γέμισε μνήμη – ο trainer θα ξαναδοκιμάσει αυτόματα";
		}
		if (s.indexOf("none of the reviewed names matched a jpg") !== -1 || s.indexOf("frames folder not found") !== -1 || (s.indexOf("folder not found") !== -1 && /frame|image|jpg/.test(s))) {
			return "Ο trainer δεν βρίσκει τις εικόνες του φακέλου";
		}
		return "Πρόβλημα στον trainer – δείτε το παράθυρο του trainer";
	}

	function statusMoment(doc) {
		return {
			cycle: asNumber(pick(doc, ["cycle", "cycle_index", "cycleIndex"])),
			state: normState(pick(doc, ["state", "status"])),
			updated: pick(doc, ["updated_at", "updatedAt", "timestamp", "time", "last_update", "finished_at"])
		};
	}

	function momentNewer(a, b) {
		if (a == null || b == null || a === "" || b === "") return false;
		var da = Date.parse(a), db = Date.parse(b);
		if (!isNaN(da) && !isNaN(db)) return da > db;
		return String(a) > String(b);
	}

	function errorIsStale(doc, raw) {
		var now, errCycle;
		if (!shownError || shownError.text !== raw) return false;
		now = statusMoment(doc);
		if (now.state === "error") return false;
		errCycle = asNumber(pick(doc, ["last_error_cycle", "error_cycle", "lastErrorCycle"]));
		if (errCycle != null && now.cycle != null && now.cycle > errCycle) return true;
		if (now.cycle != null && shownError.cycle != null && now.cycle > shownError.cycle) return true;
		if ((now.state === "idle" || now.state === "predicting") && shownError.state && shownError.state !== now.state && momentNewer(now.updated, shownError.updated)) return true;
		return false;
	}

	function trainerErrorView(doc) {
		var raw = rawTrainerError(doc);
		var now, still;
		if (!raw) {
			shownError = null;
			dismissedError = null;
			return { text: "", title: "" };
		}
		now = statusMoment(doc);
		still = dismissedError && dismissedError.text === raw && now.state !== "error" && now.cycle != null && dismissedError.cycle != null && now.cycle <= dismissedError.cycle;
		if (still) return { text: "", title: "" };
		if (dismissedError && dismissedError.text !== raw) dismissedError = null;
		if (!shownError || shownError.text !== raw) {
			shownError = { text: raw, cycle: now.cycle, state: now.state, updated: now.updated };
			return { text: greekTrainerError(raw), title: raw };
		}
		if (errorIsStale(doc, raw)) {
			dismissedError = { text: raw, cycle: now.cycle != null ? now.cycle : shownError.cycle };
			shownError = null;
			return { text: "", title: "" };
		}
		return { text: greekTrainerError(raw), title: raw };
	}

	function paintError(text, title) {
		var el = document.getElementById("liveTrainerErr");
		if (!el) return;
		el.textContent = text || "";
		el.hidden = !text;
		el.title = title || "";
	}

	function setText(id, text) {
		var el = document.getElementById(id);
		if (!el) return;
		el.textContent = text || "";
		el.hidden = !text;
	}

	function hideCoverage() {
		var el = document.getElementById("liveTrainer");
		var badge = document.getElementById("framePredict");
		if (el) el.hidden = true;
		if (badge) badge.hidden = true;
	}

	function frameBadge() {
		var el = document.getElementById("framePredict");
		if (el) return el;
		var box = document.getElementById("box");
		if (!box) return null;
		el = document.createElement("div");
		el.id = "framePredict";
		el.hidden = true;
		box.appendChild(el);
		return el;
	}

	function paintFramePredict() {
		var badge = frameBadge();
		var name, hit, cover, cur, endN;
		if (!badge) return;
		if (!connected || !predictionsApply()) {
			badge.hidden = true;
			badge.textContent = "";
			return;
		}
		name = (typeof imName !== "undefined" && imName) ? imName : "";
		if (!name) {
			badge.hidden = true;
			return;
		}
		hit = !!findFrame(predictions, name);
		badge.hidden = false;
		badge.className = "";
		if (hit) {
			badge.className = "has";
			badge.textContent = "πρόβλεψη";
			return;
		}
		cover = predictionCoverage();
		cur = numericStem(name);
		endN = cover && cover.end ? cover.end.n : null;
		if (cur && endN != null && cur.n > endN) {
			badge.className = "ahead";
			badge.textContent = "μπροστά από το μοντέλο";
			return;
		}
		badge.className = "miss";
		badge.textContent = "χωρίς πρόβλεψη";
	}

	function formatMapScore(v) {
		var n = asNumber(v);
		if (n == null) return "—";
		return n.toFixed(3);
	}

	function normClass(name) {
		return String(name || "").replace(/\s*\|\s*/g, "|").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "").toLowerCase();
	}

	function prettyClass(name) {
		var parts = String(name || "").split("|");
		var i;
		if (parts.length < 2) return String(name || "").replace(/^\s+|\s+$/g, "");
		for (i = 0; i < parts.length; i++) parts[i] = parts[i].replace(/^\s+|\s+$/g, "");
		return parts[0] + " | " + parts.slice(1).join("|");
	}

	function scoreBand(score) {
		if (score == null) return "none";
		if (score >= 0.98) return "good";
		if (score >= 0.8) return "mid";
		return "bad";
	}

	function projectClasses() {
		var out = [], seen = {}, images, name, anns, i, a, list;
		function add(brand, location) {
			var key;
			brand = String(brand || "").replace(/^\s+|\s+$/g, "");
			location = String(location || "").replace(/^\s+|\s+$/g, "");
			if (!brand || !location) return;
			key = normClass(brand + "|" + location);
			if (seen[key]) return;
			seen[key] = true;
			out.push({ label: brand + " | " + location, key: key });
		}
		images = (typeof allAnnotations !== "undefined" && allAnnotations && allAnnotations.images) || {};
		for (name in images) {
			if (!Object.prototype.hasOwnProperty.call(images, name)) continue;
			anns = images[name].annotations || [];
			for (i = 0; i < anns.length; i++) add(anns[i].brand, anns[i].tpoint);
		}
		try {
			if (typeof brd !== "undefined" && brd && brd.objectsList) {
				list = brd.objectsList;
				for (i = 0; i < list.length; i++) {
					a = list[i] && list[i].annotation;
					if (!a || list[i]._liveSuggest) continue;
					add(a.brand, a.tpoint);
				}
			}
		} catch (e) {}
		return out;
	}

	function mapRows(doc) {
		var scores = classMapRows(doc);
		var byName = {}, i, row, known, key, hit, rows = [];
		for (i = 0; i < scores.length; i++) byName[normClass(scores[i].name)] = scores[i];
		known = projectClasses();
		for (i = 0; i < known.length; i++) {
			hit = byName[known[i].key];
			rows.push({
				label: known[i].label,
				score: hit ? hit.score : null,
				instances: hit ? hit.instances : null,
				frames: hit ? hit.frames : null
			});
			byName[known[i].key] = null;
		}
		for (i = 0; i < scores.length; i++) {
			key = normClass(scores[i].name);
			if (!key || byName[key] === null) continue;
			if (!byName[key]) continue;
			rows.push({
				label: prettyClass(scores[i].name),
				score: scores[i].score,
				instances: scores[i].instances,
				frames: scores[i].frames
			});
			byName[key] = null;
		}
		rows.sort(function (a, b) {
			if ((a.score == null) !== (b.score == null)) return a.score == null ? 1 : -1;
			if (a.score != null && b.score != null && a.score !== b.score) return b.score - a.score;
			return a.label.localeCompare(b.label);
		});
		return rows;
	}

	function countLabel(row) {
		var bits = [];
		if (row.instances != null) bits.push(row.instances + " δείγματα");
		if (row.frames != null) bits.push(row.frames + " καρέ");
		return bits.join(" · ");
	}

	function mapWhen(doc) {
		var cycle, when, bits;
		if (!doc) return "";
		cycle = asNumber(pick(doc, ["cycle", "cycle_index", "cycleIndex"]));
		when = shortTime(pick(doc, ["updated_at", "updatedAt", "timestamp", "time", "last_update", "finished_at"]));
		bits = [];
		if (cycle != null) bits.push("κύκλο " + cycle);
		if (when) bits.push(when);
		return bits.length ? ("τιμές από " + bits.join(", ")) : "";
	}

	function paintMapPanel(doc) {
		var list = document.getElementById("mapList");
		var empty = document.getElementById("mapEmpty");
		var whenEl = document.getElementById("mapPanelWhen");
		var countEl = document.getElementById("mapPanelCount");
		var rows, when, sig, i, row, el, name, score, meta;
		if (!list) return;
		rows = mapRows(doc);
		when = mapWhen(doc);
		sig = (connected ? "1" : "0") + "\n" + when + "\n" + rows.map(function (r) {
			return r.label + "\t" + r.score + "\t" + r.instances + "\t" + r.frames;
		}).join("\n");
		if (sig === mapSig && list.childNodes.length === rows.length) return;
		mapSig = sig;
		list.innerHTML = "";
		for (i = 0; i < rows.length; i++) {
			row = rows[i];
			el = document.createElement("div");
			el.className = "map-row is-" + scoreBand(row.score);
			name = document.createElement("span");
			name.className = "map-name";
			name.textContent = row.label;
			score = document.createElement("span");
			score.className = "map-score";
			score.textContent = formatMapScore(row.score);
			meta = document.createElement("span");
			meta.className = "map-meta";
			meta.textContent = countLabel(row);
			el.appendChild(name);
			el.appendChild(score);
			el.appendChild(meta);
			list.appendChild(el);
		}
		if (countEl) countEl.textContent = rows.length ? String(rows.length) : "";
		if (whenEl) whenEl.textContent = when;
		if (empty) {
			empty.style.display = rows.length ? "none" : "block";
			empty.textContent = connected ? "Ο trainer δεν έχει στείλει ακόμα mAP50." : "Σύνδεσε τον φάκελο με το Ζωντανά για να έρθουν οι τιμές.";
		}
	}

	function placeMapPanel() {
		var panel = document.getElementById("mapPanel");
		var saved = null, maxLeft, maxTop;
		if (!panel) return;
		try { saved = JSON.parse(localStorage.getItem(MAP_POS_KEY) || "null"); } catch (e) {}
		if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
			maxLeft = Math.max(8, window.innerWidth - 80);
			maxTop = Math.max(8, window.innerHeight - 80);
			panel.style.left = Math.max(8, Math.min(saved.left, maxLeft)) + "px";
			panel.style.top = Math.max(8, Math.min(saved.top, maxTop)) + "px";
			panel.style.right = "auto";
			return;
		}
		panel.style.top = "132px";
		panel.style.left = "12px";
		panel.style.right = "auto";
	}

	function setMapPanel(open) {
		var panel = document.getElementById("mapPanel");
		var btn = document.getElementById("mapGlanceOpen");
		if (!panel) return;
		if (open) placeMapPanel();
		panel.classList.toggle("open", !!open);
		panel.setAttribute("aria-hidden", open ? "false" : "true");
		if (btn) btn.classList.toggle("on", !!open);
		try { localStorage.setItem(MAP_OPEN_KEY, open ? "1" : "0"); } catch (e) {}
		if (open) {
			mapSig = "";
			paintMapPanel(trainerDoc && !trainerBad ? trainerDoc : null);
		}
	}

	function toggleMapPanel() {
		var panel = document.getElementById("mapPanel");
		setMapPanel(!(panel && panel.classList.contains("open")));
	}

	function initMapPanel() {
		var open = false, flag, panel, head;
		try {
			flag = localStorage.getItem(MAP_OPEN_KEY);
			if (flag === "1") open = true;
			else if (flag === "0") open = false;
			else open = window.innerWidth >= 1600;
		} catch (e) {
			open = window.innerWidth >= 1600;
		}
		setMapPanel(open);
		panel = document.getElementById("mapPanel");
		head = document.getElementById("mapPanelHead");
		if (panel) {
			panel.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: true });
		}
		if (head) {
			head.addEventListener("mousedown", function (e) {
				var rect;
				if (e.target && e.target.closest && e.target.closest("button, input")) return;
				rect = panel.getBoundingClientRect();
				mapDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
				e.preventDefault();
			});
		}
		document.addEventListener("mousemove", function (e) {
			var left, top;
			if (!mapDrag || !panel) return;
			left = Math.max(8, e.clientX - mapDrag.dx);
			top = Math.max(8, e.clientY - mapDrag.dy);
			panel.style.left = left + "px";
			panel.style.top = top + "px";
			panel.style.right = "auto";
		});
		document.addEventListener("mouseup", function () {
			var rect;
			if (!mapDrag || !panel) return;
			mapDrag = null;
			rect = panel.getBoundingClientRect();
			try { localStorage.setItem(MAP_POS_KEY, JSON.stringify({ left: rect.left, top: rect.top })); } catch (e) {}
		});
		setInterval(function () {
			if (panel && panel.classList.contains("open")) paintMapPanel(trainerDoc && !trainerBad ? trainerDoc : null);
		}, 1000);
	}

	function familiesOf(doc) {
		var raw = doc ? pick(doc, ["families", "model_families", "modelFamilies"]) : null;
		var out = [], i, item, name, seen = {};
		if (typeof raw === "string") raw = raw.split(",");
		if (!raw || Object.prototype.toString.call(raw) !== "[object Array]") return out;
		for (i = 0; i < raw.length; i++) {
			item = raw[i];
			if (item && typeof item === "object") name = pick(item, ["family", "name", "model_family", "modelFamily"]);
			else name = item;
			name = String(name == null ? "" : name).replace(/^\s+|\s+$/g, "");
			if (!name || seen[name]) continue;
			seen[name] = true;
			out.push(name);
		}
		return out;
	}

	function classDetail(item) {
		if (item == null || typeof item !== "object") return { score: asNumber(item), instances: null, frames: null };
		return {
			score: asNumber(pick(item, ["map50", "map_50", "mAP50", "score", "ap"])),
			instances: asNumber(pick(item, ["instances", "instance_count", "n_instances", "count", "boxes", "n"])),
			frames: asNumber(pick(item, ["frames", "n_frames", "frame_count", "images", "n_images"]))
		};
	}

	function classMapRows(doc) {
		var raw = doc ? pick(doc, ["per_class_map50", "perClassMap50", "per_class_map", "class_map50"]) : null;
		var rows = [], i, item, name, detail;
		if (!raw) return rows;
		if (Object.prototype.toString.call(raw) === "[object Array]") {
			for (i = 0; i < raw.length; i++) {
				item = raw[i];
				if (item == null) continue;
				if (typeof item !== "object") { rows.push({ name: String(item), score: null, instances: null, frames: null }); continue; }
				name = pick(item, ["class", "name", "label", "cls"]);
				detail = classDetail(item);
				if (name != null) rows.push({ name: String(name), score: detail.score, instances: detail.instances, frames: detail.frames });
			}
		} else if (typeof raw === "object") {
			for (name in raw) {
				if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
				detail = classDetail(raw[name]);
				rows.push({ name: name, score: detail.score, instances: detail.instances, frames: detail.frames });
			}
		}
		fillParallelCounts(doc, rows);
		return rows;
	}

	function lookupCount(table, name) {
		var want, k, n;
		if (!table || typeof table !== "object") return null;
		if (table[name] != null && typeof table[name] !== "object") {
			n = asNumber(table[name]);
			if (n != null) return n;
		}
		want = normClass(name);
		for (k in table) {
			if (!Object.prototype.hasOwnProperty.call(table, k) || normClass(k) !== want) continue;
			n = asNumber(table[k]);
			if (n == null && table[k] && typeof table[k] === "object") n = asNumber(pick(table[k], ["instances", "count", "n", "frames", "n_frames"]));
			return n;
		}
		return null;
	}

	function fillParallelCounts(doc, rows) {
		var inst = doc ? pick(doc, ["per_class_instances", "perClassInstances", "class_instances"]) : null;
		var frames = doc ? pick(doc, ["per_class_frames", "perClassFrames", "class_frames"]) : null;
		var i, n;
		if (Object.prototype.toString.call(inst) !== "[object Object]") inst = null;
		if (Object.prototype.toString.call(frames) !== "[object Object]") frames = null;
		if (!inst && !frames) return;
		for (i = 0; i < rows.length; i++) {
			if (rows[i].instances == null && inst && typeof inst === "object") {
				n = lookupCount(inst, rows[i].name);
				if (n != null) rows[i].instances = n;
			}
			if (rows[i].frames == null && frames && typeof frames === "object") {
				n = lookupCount(frames, rows[i].name);
				if (n != null) rows[i].frames = n;
			}
		}
	}

	function modelLine(doc) {
		var family, mode;
		if (!doc) return "";
		family = pick(doc, ["model_family", "modelFamily", "family"]);
		mode = pick(doc, ["model_mode", "modelMode", "mode"]);
		if (family == null && mode == null) return "";
		if (family != null && mode != null && String(mode) !== "") return "Μοντέλο: " + family + " (" + mode + ")";
		if (family != null) return "Μοντέλο: " + family;
		return "Μοντέλο: (" + mode + ")";
	}

	function addOpt(sel, value, label) {
		var opt = document.createElement("option");
		opt.value = value;
		opt.textContent = label;
		sel.appendChild(opt);
	}

	function paintModelChoice(doc) {
		var sel = document.getElementById("liveModelChoice");
		var text = document.getElementById("liveModelFromText");
		var fams, choice, fromName, useList, sig, want, i, busy;
		if (!sel) return;
		fams = (doc && !trainerBad) ? familiesOf(doc) : [];
		choice = modelChoice;
		fromName = choice.indexOf("from:") === 0 ? choice.slice(5).replace(/^\s+|\s+$/g, "") : "";
		useList = fams.length > 0;
		sig = (useList ? fams.join("\n") : "text");
		busy = document.activeElement === sel || document.activeElement === text;
		if (sig !== modelUiSig && !busy) {
			modelUiSig = sig;
			sel.innerHTML = "";
			addOpt(sel, "continue", "συνέχεια");
			addOpt(sel, "new", "νέο μοντέλο");
			if (useList) {
				for (i = 0; i < fams.length; i++) addOpt(sel, "from:" + fams[i], "συνέχεια από " + fams[i]);
				if (fromName && fams.indexOf(fromName) === -1) addOpt(sel, "from:" + fromName, "συνέχεια από " + fromName);
			} else addOpt(sel, "from", "συνέχεια από…");
		}
		want = useList ? (fromName ? "from:" + fromName : (choice === "new" ? "new" : "continue")) : (choice.indexOf("from:") === 0 ? "from" : (choice === "new" ? "new" : "continue"));
		if (!busy && sel.value !== want) sel.value = want;
		if (text) {
			text.hidden = useList || sel.value !== "from";
			if (!text.hidden && document.activeElement !== text && text.value !== fromName) text.value = fromName;
		}
	}

	function onModelInput() {
		var sel = document.getElementById("liveModelChoice");
		var text = document.getElementById("liveModelFromText");
		var v = sel ? sel.value : "continue";
		var name = text ? String(text.value || "").replace(/^\s+|\s+$/g, "") : "";
		if (v === "from") modelChoice = name ? "from:" + name : "from:";
		else if (v.indexOf("from:") === 0) modelChoice = v;
		else if (v === "new") modelChoice = "new";
		else modelChoice = "continue";
		saveModel();
		if (text) text.hidden = v !== "from";
		if (connected && !flushing) scheduleChange();
	}

	function paintTrainer() {
		var root = document.getElementById("liveTrainer");
		var phrase, cover, prog, map, when, err, model, reviewedCount, classCount, bits, any, doc;
		if (!root) return;
		if (!connected) {
			root.hidden = true;
			paintMapPanel(null);
			hideWait();
			return;
		}
		doc = trainerDoc && !trainerBad ? trainerDoc : null;
		phrase = doc ? trainerPhrase(doc) : "";
		cover = predictionCoverage();
		prog = doc ? trainerProgress(doc) : "";
		map = doc ? formatMap(pick(doc, ["last_map50", "lastMap50", "map50", "mAP50", "map_50"])) : "";
		when = doc ? shortTime(pick(doc, ["updated_at", "updatedAt", "timestamp", "time", "last_update", "finished_at"])) : "";
		err = trainerBad ? { text: "μη έγκυρη κατάσταση", title: "" } : (trainerDoc ? trainerErrorView(trainerDoc) : { text: "", title: "" });
		model = modelLine(doc);
		setText("liveTrainerMain", phrase);
		setText("liveTrainerRange", cover ? cover.text : "");
		setText("liveTrainerProg", prog);
		setText("liveTrainerMap", map);
		setText("liveTrainerTime", when);
		setText("liveTrainerModel", model);
		paintError(err.text, err.title);
		paintModelChoice(doc);
		paintMapPanel(doc);
		paintPrepare();
		any = phrase || (cover && cover.text) || prog || map || when || err.text || model || connected;
		root.hidden = !any;
		bits = [];
		if (doc) {
			reviewedCount = pick(doc, ["reviewed", "reviewed_count", "reviewedCount"]);
			classCount = asCount(pick(doc, ["classes", "class_count", "classCount", "n_classes"]));
			if (reviewedCount != null) bits.push("reviewed " + reviewedCount);
			if (classCount != null) bits.push(classCount + " κλάσεις");
			if (err.text) bits.push(err.text);
		}
		root.title = bits.join(" · ");
	}

	function paint() {
		var root = document.getElementById("liveSync");
		var btn = document.getElementById("liveSyncBtn");
		var state = document.getElementById("liveSyncState");
		if (!connected) hideCoverage();
		if (!root || !btn || !state) return;
		if (!supported()) {
			root.className = "unsupported";
			btn.style.display = "none";
			var dot = document.getElementById("liveSyncDot");
			if (dot) dot.style.display = "none";
			state.textContent = "Ζωντανά: χρειάζεται Chrome ή Edge";
			return;
		}
		btn.style.display = "";
		var dotOn = document.getElementById("liveSyncDot");
		if (dotOn) dotOn.style.display = "";
		if (connected) {
			root.className = "on";
			btn.textContent = "Διακοπή";
			state.textContent = "συνδεδεμένο · " + ((dirHandle && dirHandle.name) || "φάκελος");
			return;
		}
		root.className = "off";
		btn.textContent = savedHandle ? "Σύνδεση" : "Ζωντανά";
		state.textContent = "εκτός";
	}

	function idb() {
		if (dbp) return dbp;
		dbp = new Promise(function (resolve, reject) {
			var req = indexedDB.open(DB_NAME, 1);
			req.onupgradeneeded = function () {
				if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
			};
			req.onsuccess = function () { resolve(req.result); };
			req.onerror = function () { reject(req.error); };
		});
		return dbp;
	}

	function idbGet(key) {
		return idb().then(function (db) {
			return new Promise(function (resolve, reject) {
				var tx = db.transaction(DB_STORE, "readonly");
				var req = tx.objectStore(DB_STORE).get(key);
				req.onsuccess = function () { resolve(req.result); };
				req.onerror = function () { reject(req.error); };
			});
		});
	}

	function idbSet(key, value) {
		return idb().then(function (db) {
			return new Promise(function (resolve, reject) {
				var tx = db.transaction(DB_STORE, "readwrite");
				tx.objectStore(DB_STORE).put(value, key);
				tx.oncomplete = function () { resolve(); };
				tx.onerror = function () { reject(tx.error); };
			});
		});
	}

	function permission(handle, request) {
		var opts = { mode: "readwrite" };
		if (!handle || typeof handle.queryPermission !== "function") {
			return Promise.resolve(request ? "granted" : "prompt");
		}
		return Promise.resolve(handle.queryPermission(opts)).then(function (state) {
			if (state === "granted" || !request) return state;
			if (typeof handle.requestPermission !== "function") return state;
			return handle.requestPermission(opts);
		});
	}

	function pickDirectory() {
		return window.showDirectoryPicker({ mode: "readwrite", id: "annotool-livesync" }).catch(function (err) {
			if (err && err.name === "AbortError") throw err;
			return window.showDirectoryPicker({ mode: "readwrite" });
		});
	}

	function readText(file) {
		if (file && typeof file.text === "function") return Promise.resolve(file.text());
		return new Promise(function (resolve, reject) {
			var reader = new FileReader();
			reader.onload = function () { resolve(String(reader.result || "")); };
			reader.onerror = function () { reject(reader.error); };
			reader.readAsText(file);
		});
	}

	function writeAtomic(dir, name, text) {
		return dir.getFileHandle(name, { create: true }).then(function (file) {
			return file.createWritable().then(function (stream) {
				return stream.write(text).then(function () {
					return stream.close();
				}).catch(function (err) {
					var abort = stream.abort ? stream.abort() : Promise.resolve();
					return Promise.resolve(abort).then(function () { throw err; }, function () { throw err; });
				});
			});
		});
	}

	function buildLiveText() {
		var name, saved, keepSaved;
		ensureReviewed();
		name = (typeof imName !== "undefined" && imName) ? imName : "";
		saved = name && allAnnotations && allAnnotations.images && allAnnotations.images[name];
		keepSaved = saved && saved.annotations && saved.annotations.length && !boardDirty;
		if (!keepSaved) {
			flushing = true;
			try { if (typeof storeAnnotationImg === "function") storeAnnotationImg(); }
			catch (e) {}
			flushing = false;
		}
		var payload = JSON.parse(JSON.stringify(allAnnotations));
		var project = currentProject();
		if (project) {
			payload.project = project;
			if (payload.prefs) payload.prefs.projectName = project;
		}
		if (typeof imName !== "undefined" && imName) payload.currentImage = imName;
		payload.syncedAt = new Date().toISOString();
		payload.currentImageIndex = (typeof imIndex === "number") ? imIndex : null;
		payload.reviewed = reviewed.slice();
		payload.rejected = JSON.parse(JSON.stringify(rejected || {}));
		payload.modelFamily = resolvedFamily();
		payload.modelChoice = resolvedChoice();
		return JSON.stringify(payload);
	}

	function bodyOf(text) {
		try {
			var obj = JSON.parse(text);
			delete obj.syncedAt;
			return JSON.stringify(obj);
		} catch (e) { return text; }
	}

	function onWriteError(err) {
		var name = err && err.name;
		if (name === "NotAllowedError" || name === "SecurityError") {
			connected = false;
			stopPoll();
			paint();
			note("η άδεια του φακέλου έληξε — πάτα Σύνδεση");
		}
	}

	function restoreMemoryImages(images) {
		if (typeof allAnnotations === "undefined" || !allAnnotations || !images) return;
		try { allAnnotations.images = JSON.parse(JSON.stringify(images)); } catch (e) {}
	}

	function adoptLiveDoc(doc) {
		var project, fromFile, fromBrowser, addedBare;
		if (!doc) return;
		project = currentProject();
		if (!project) return;
		if (doc.project && String(doc.project) !== String(project)) return;
		if (!reviewedProject) reviewedProject = project;
		fromFile = [];
		fromBrowser = [];
		if (!navReviews) {
			fromFile = reviewedNames(doc.reviewed);
			fromBrowser = readStoredReviewed();
			reviewed = unionReviewed(fromBrowser, fromFile);
			saveReviewed();
		}
		if (!userCleared && !allowEmptyWrite && typeof allAnnotations !== "undefined" && allAnnotations && annotationCount(allAnnotations.images) === 0 && annotationCount(doc.images) > 0) {
			restoreMemoryImages(doc.images);
		}
		if (!navReviews) {
			addedBare = withoutBoxes(fromBrowser.filter(function (name) { return fromFile.indexOf(name) === -1; }));
			warnBareReviewed(addedBare);
		}
		mergeRejected(doc);
		absorbModel(doc);
		liveReviewedAdopted = true;
	}

	function pullLiveState() {
		if (!dirHandle) {
			if (!liveReviewedAdopted && !navReviews) loadReviewedList();
			liveReviewedAdopted = true;
			return Promise.resolve();
		}
		return readNamed(LIVE_FILE).then(function (text) {
			var doc = null;
			try { doc = JSON.parse(text); } catch (e) { doc = null; }
			if (doc) adoptLiveDoc(doc);
			if (!liveReviewedAdopted && !navReviews) loadReviewedList();
			liveReviewedAdopted = true;
		}).catch(function () {
			if (!navReviews) loadReviewedList();
			liveReviewedAdopted = true;
		});
	}

	function applyLiveGuards(next, prev) {
		var nextN, prevN, snapN, same;
		if (!next) return;
		if (userCleared || allowEmptyWrite) {
			userCleared = false;
			allowEmptyWrite = false;
			return;
		}
		nextN = annotationCount(next.images);
		prevN = prev ? annotationCount(prev.images) : 0;
		snapN = annotationCount(hydratedImages);
		same = !prev || !prev.project || !next.project || String(prev.project) === String(next.project);
		if (nextN === 0 && same && prevN > 0) {
			next.images = prev.images;
			restoreMemoryImages(prev.images);
		} else if (nextN === 0 && snapN > 0 && (!hydratedProject || !next.project || String(hydratedProject) === String(next.project))) {
			try { next.images = JSON.parse(JSON.stringify(hydratedImages)); } catch (e) { next.images = hydratedImages; }
			restoreMemoryImages(hydratedImages);
		}
	}

	function protectLive(text) {
		var next;
		try { next = JSON.parse(text); }
		catch (e) { return Promise.resolve(text); }
		if (!dirHandle) {
			applyLiveGuards(next, null);
			return Promise.resolve(JSON.stringify(next));
		}
		return readNamed(LIVE_FILE).then(function (prevText) {
			var prev = null;
			try { prev = JSON.parse(prevText); } catch (e2) { prev = null; }
			applyLiveGuards(next, prev);
			return JSON.stringify(next);
		}, function () {
			applyLiveGuards(next, null);
			return JSON.stringify(next);
		});
	}

	function writesAllowed() {
		return storageReady && frameTotal() > 0;
	}

	function flush(force) {
		if (!connected || !dirHandle || !writesAllowed()) return Promise.resolve();
		clearTimeout(timer);
		var run = function () {
			if (!connected || !dirHandle || !writesAllowed()) return;
			var prepare = liveReviewedAdopted ? Promise.resolve() : pullLiveState();
			return prepare.then(function () {
				var text;
				try { text = buildLiveText(); }
				catch (e) { return; }
				return protectLive(text).then(function (safe) {
					var body = bodyOf(safe);
					if (!force && body === lastBody) return;
					return writeAtomic(dirHandle, LIVE_FILE, safe).then(function () { lastBody = body; });
				});
			});
		};
		chain = chain.then(run, run).catch(onWriteError);
		return chain;
	}

	function scheduleChange() {
		if (!connected || flushing) return;
		clearTimeout(timer);
		timer = setTimeout(function () { flush(false); }, DEBOUNCE_MS);
	}

	function absorbFileReviewed() {
		if (!dirHandle) return Promise.resolve();
		return dirHandle.getFileHandle(LIVE_FILE).then(function (file) {
			return file.getFile();
		}).then(function (file) {
			return readText(file);
		}).then(function (text) {
			var doc = JSON.parse(text);
			if (!doc) return;
			adoptLiveDoc(doc);
		}).catch(function () {});
	}

	function connectHandle(handle) {
		if (!handle) return Promise.resolve();
		dirHandle = handle;
		savedHandle = handle;
		connected = true;
		idbSet("dir", handle).catch(function () {});
		paint();
		startPoll();
		return absorbFileReviewed().then(function () {
			if (writesAllowed()) return flush(true);
		});
	}

	function disconnect() {
		connected = false;
		clearTimeout(timer);
		stopPoll();
		statusText = null;
		trainerDoc = null;
		trainerBad = false;
		prepareShown = false;
		prepareLatched = false;
		readyToastAt = 0;
		hideWait();
		paint();
	}

	function connectSavedOrPick() {
		if (savedHandle) {
			return permission(savedHandle, true).then(function (state) {
				if (state === "granted") return connectHandle(savedHandle);
				return pickDirectory().then(connectHandle);
			});
		}
		return pickDirectory().then(connectHandle);
	}

	function ignoreAbort(err) {
		if (err && err.name === "AbortError") return;
		note("ο φάκελος δεν συνδέθηκε");
	}

	function stemOf(name) {
		name = String(name || "").replace(/\\/g, "/");
		var base = name.split("/").pop();
		var dot = base.lastIndexOf(".");
		if (dot > 0) base = base.slice(0, dot);
		return base;
	}

	function dirPrefix(name) {
		name = String(name || "").replace(/\\/g, "/");
		var cut = name.lastIndexOf("/");
		return cut < 0 ? "" : name.slice(0, cut);
	}

	function openImageSet() {
		var set = {}, i, key, n = 0, list;
		list = (typeof imIndices !== "undefined" && imIndices && imIndices.length) ? imIndices : null;
		if (list) {
			for (i = 0; i < list.length; i++) if (list[i]) { set[String(list[i])] = true; n++; }
		} else if (typeof imAll !== "undefined" && imAll) {
			for (key in imAll) if (Object.prototype.hasOwnProperty.call(imAll, key) && key) { set[String(key)] = true; n++; }
		}
		return n ? set : null;
	}

	function keyInOpenFolder(key) {
		var set = openImageSet(), loaded, ps, ls, pd, ld;
		if (!set) return true;
		if (key == null || key === "") return false;
		key = String(key);
		if (set[key]) return true;
		ps = stemOf(key);
		pd = dirPrefix(key);
		for (loaded in set) {
			if (!Object.prototype.hasOwnProperty.call(set, loaded)) continue;
			ls = stemOf(loaded);
			if (!ps || ps !== ls) continue;
			ld = dirPrefix(loaded);
			if (pd === ld || !pd) return true;
		}
		return false;
	}

	function predictionKeysInFolder() {
		var images, key, out = [];
		if (!predictions || !predictions.images) return out;
		images = predictions.images;
		for (key in images) {
			if (!Object.prototype.hasOwnProperty.call(images, key) || !images[key]) continue;
			if (keyInOpenFolder(key)) out.push(key);
		}
		return out;
	}

	function findFrame(doc, name) {
		if (!doc || !doc.images || !name) return null;
		var images = doc.images;
		if (images[name] && images[name].annotations && keyInOpenFolder(name)) return images[name];
		var bare = (typeof bareImageName === "function") ? bareImageName(name) : name;
		if (bare !== name && images[bare] && images[bare].annotations && keyInOpenFolder(bare)) return images[bare];
		var stem = stemOf(name);
		var key, img, label, loose = null;
		for (key in images) {
			if (!images.hasOwnProperty(key) || !images[key]) continue;
			if (!keyInOpenFolder(key)) continue;
			img = images[key];
			label = img.imageName || key;
			if (label === name || key === name) return img;
			if ((stemOf(label) === stem || stemOf(key) === stem) && !loose) loose = img;
		}
		return loose;
	}

	function hasUserAnnotations() {
		var stored, i, obj;
		if (typeof imName === "undefined" || !imName) return false;
		stored = allAnnotations && allAnnotations.images && allAnnotations.images[imName];
		if (stored && stored.annotations && stored.annotations.length) return true;
		if (typeof brd === "undefined" || !brd || !brd.objectsList) return false;
		for (i = 0; i < brd.objectsList.length; i++) {
			obj = brd.objectsList[i];
			if (!obj || !obj.getType || obj.getType() !== "polygon" || obj._liveSuggest) continue;
			if (obj.getAttribute && obj.getAttribute("visible") === false) continue;
			return true;
		}
		return false;
	}

	function restyleSuggest(poly) {
		var i;
		try {
			poly.setAttribute({ fillColor: "#f0b429", fillOpacity: 0.18 });
			for (i = 0; poly.borders && i < poly.borders.length; i++) {
				poly.borders[i].setAttribute({ strokeColor: "#e6a100", strokeWidth: 2, dash: 2 });
			}
		} catch (e) {}
	}

	function restyleNormal(poly) {
		var i, color = (typeof boxborder !== "undefined") ? boxborder : "#4fe2ff";
		var width = (typeof boxborderwidth !== "undefined") ? boxborderwidth : 2;
		try {
			poly.setAttribute({ fillColor: "none", fillOpacity: 0 });
			for (i = 0; poly.borders && i < poly.borders.length; i++) {
				poly.borders[i].setAttribute({ strokeColor: color, strokeWidth: width, dash: 0 });
			}
		} catch (e) {}
	}

	function placeBox(ann, frameW, frameH) {
		var sx = 1, sy = 1, poly;
		if (!(ann && ann.startPoint && ann.diagPoint && ann.startPoint.length > 1 && ann.diagPoint.length > 1)) return null;
		if (frameW > 0 && frameH > 0 && typeof imWidth !== "undefined" && imWidth > 0 && imHeight > 0) {
			sx = imWidth / frameW;
			sy = imHeight / frameH;
		}
		try {
			poly = createPolygon(
				[ann.startPoint[0] * sx, ann.startPoint[1] * sy],
				[ann.diagPoint[0] * sx, ann.diagPoint[1] * sy]
			);
		} catch (e) { return null; }
		poly.annotation = {
			group: ann.group || "",
			brand: ann.brand || "",
			tpoint: (typeof tpointText === "function") ? tpointText(ann.tpoint || "") : (ann.tpoint || ""),
			hits: (typeof instanceHits === "function") ? instanceHits(ann) : (parseInt(ann.hits, 10) >= 1 ? parseInt(ann.hits, 10) : 1)
		};
		poly._liveSuggest = true;
		poly._liveConf = (typeof annotationConfidence === "function") ? annotationConfidence(ann) : null;
		restyleSuggest(poly);
		return poly;
	}

	function predictionsApply() {
		if (!predictions || typeof predictions !== "object") return false;
		var tagged = predictions.project;
		if (tagged != null && String(tagged) !== "") {
			var project = currentProject();
			if (project && String(tagged) !== String(project)) return false;
		}
		if (openImageSet() && !predictionKeysInFolder().length) return false;
		return true;
	}

	function clearShownPredictions() {
		var copy = shown.slice(), i;
		clearingPredictions = true;
		shown = [];
		dismiss = false;
		clearUi();
		for (i = 0; i < copy.length; i++) {
			if (copy[i] && typeof removePolygon === "function") removePolygon(copy[i]);
		}
		clearingPredictions = false;
		dismiss = false;
	}

	function showForCurrent() {
		var frame, list, i, poly, n;
		if (!connected || dismiss || !predictionsApply()) return;
		if (typeof imName === "undefined" || !imName) return;
		if (typeof brd === "undefined" || !brd || typeof createPolygon !== "function") return;
		if (hasUserAnnotations()) return;
		if (shown.length) return;
		frame = findFrame(predictions, imName);
		if (!frame || !frame.annotations || !frame.annotations.length) return;
		list = frame.annotations;
		n = list.length > 80 ? 80 : list.length;
		for (i = 0; i < n; i++) {
			poly = placeBox(list[i], frame.width, frame.height);
			if (!poly) continue;
			poly._liveFrame = imName;
			shown.push(poly);
		}
		if (!shown.length) return;
		renderUi();
		startFollow();
	}

	function stop(e) {
		e.stopPropagation();
		if (e.preventDefault) e.preventDefault();
	}

	function clearUi() {
		var bar = document.getElementById("livePredictBar");
		var chips = document.getElementById("livePredictChips");
		if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
		if (chips && chips.parentNode) chips.parentNode.removeChild(chips);
	}

	function chipText(poly) {
		var ann = poly.annotation || {};
		var text = (ann.brand || "—") + " · " + (ann.tpoint || "—") + " · " + (ann.hits || 1);
		if (typeof poly._liveConf === "number") {
			var pct = poly._liveConf <= 1 ? Math.round(poly._liveConf * 100) : Math.round(poly._liveConf);
			text += " · " + pct + "%";
		}
		return text;
	}

	function renderUi() {
		var board = document.getElementById("box");
		var bar, label, hint, chips, i, chip, text, yes, no;
		if (!board) return;
		clearUi();
		bar = document.createElement("div");
		bar.id = "livePredictBar";
		label = document.createElement("span");
		label.textContent = "Προβλέψεις " + shown.length;
		bar.appendChild(label);
		bar.appendChild(actionButton("Όλες", "all"));
		bar.appendChild(actionButton("Καμία", "none"));
		hint = document.createElement("span");
		hint.className = "liveHint";
		hint.textContent = "σύρε για διόρθωση";
		bar.appendChild(hint);
		bar.addEventListener("mousedown", stop);
		bar.addEventListener("pointerdown", stop);
		bar.addEventListener("click", onBarClick);
		board.appendChild(bar);
		chips = document.createElement("div");
		chips.id = "livePredictChips";
		for (i = 0; i < shown.length; i++) {
			chip = document.createElement("div");
			chip.className = "liveChip";
			chip.setAttribute("data-id", shown[i].id);
			text = document.createElement("span");
			text.className = "liveChipText";
			text.textContent = chipText(shown[i]);
			yes = actionButton("Ναι", "yes");
			no = actionButton("Όχι", "no");
			chip.appendChild(text);
			chip.appendChild(yes);
			chip.appendChild(no);
			chip.addEventListener("mousedown", stop);
			chip.addEventListener("pointerdown", stop);
			chip.addEventListener("click", onChipClick);
			chips.appendChild(chip);
		}
		board.appendChild(chips);
		placeChips();
	}

	function actionButton(label, act) {
		var btn = document.createElement("button");
		btn.type = "button";
		btn.setAttribute("data-act", act);
		btn.textContent = label;
		return btn;
	}

	function polyById(id) {
		var i;
		for (i = 0; i < shown.length; i++) if (shown[i] && shown[i].id === id) return shown[i];
		return null;
	}

	function dropShown(poly) {
		var next = [], i;
		for (i = 0; i < shown.length; i++) if (shown[i] !== poly) next.push(shown[i]);
		shown = next;
	}

	function acceptPoly(poly) {
		if (!poly || !poly._liveSuggest) return;
		poly._liveSuggest = false;
		restyleNormal(poly);
		if (!poly.annotation) poly.annotation = { group: "", brand: "", tpoint: "", hits: 1 };
		if (!poly.annotation.timestamp) poly.annotation.timestamp = new Date().toISOString();
		if ((!poly.annotation.brand || !poly.annotation.tpoint) && typeof nullAnnoFlag !== "undefined") nullAnnoFlag++;
		dropShown(poly);
		try { storeAnnotationImg(); } catch (e) {}
		if (!shown.length) clearUi();
		else renderUi();
	}

	function recordRejection(poly) {
		var ann, sd, x1, y1, x2, y2, name, entry;
		if (!poly) return;
		ensureReviewed();
		ann = poly.annotation || {};
		try { sd = (typeof getPolyStartDiag === "function") ? getPolyStartDiag(poly) : null; }
		catch (e) { sd = null; }
		if (!sd || !sd.start || !sd.diag) return;
		x1 = sd.start[0];
		y1 = sd.start[1];
		x2 = sd.diag[0];
		y2 = sd.diag[1];
		name = (typeof imName !== "undefined" && imName) ? imName : "";
		if (!name || !keyInOpenFolder(name)) return;
		if (poly._liveFrame && !keyInOpenFolder(poly._liveFrame)) return;
		entry = {
			brand: ann.brand || "",
			tpoint: ann.tpoint || "",
			x: Math.min(x1, x2),
			y: Math.min(y1, y2),
			width: Math.abs(x2 - x1),
			height: Math.abs(y2 - y1),
			confidence: (typeof poly._liveConf === "number") ? poly._liveConf : null
		};
		if (!rejected[name]) rejected[name] = [];
		rejected[name].push(entry);
		saveRejected();
		if (connected && !flushing) scheduleChange();
	}

	function rejectPoly(poly) {
		if (!poly) return;
		dropShown(poly);
		if (typeof removePolygon === "function") removePolygon(poly);
		if (!shown.length) {
			dismiss = true;
			clearUi();
		} else renderUi();
	}

	function acceptAll() {
		var copy = shown.slice(), i;
		for (i = 0; i < copy.length; i++) acceptPoly(copy[i]);
	}

	function rejectAll() {
		var copy = shown.slice(), i;
		dismiss = true;
		shown = [];
		clearUi();
		for (i = 0; i < copy.length; i++) {
			if (typeof removePolygon === "function") removePolygon(copy[i]);
		}
	}

	function onBarClick(e) {
		var act = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
		if (act === "all") acceptAll();
		else if (act === "none") rejectAll();
	}

	function onChipClick(e) {
		var act = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
		var chip = e.currentTarget;
		var poly = chip ? polyById(chip.getAttribute("data-id")) : null;
		if (!act || !poly) return;
		if (act === "yes") acceptPoly(poly);
		else if (act === "no") rejectPoly(poly);
	}

	function boxScreen(poly) {
		var sd, c1, c2, x1, y1, x2, y2;
		if (typeof JXG === "undefined" || typeof getPolyStartDiag !== "function") return null;
		sd = getPolyStartDiag(poly);
		c1 = new JXG.Coords(JXG.COORDS_BY_USER, sd.start, brd);
		c2 = new JXG.Coords(JXG.COORDS_BY_USER, sd.diag, brd);
		x1 = c1.scrCoords[1];
		y1 = c1.scrCoords[2];
		x2 = c2.scrCoords[1];
		y2 = c2.scrCoords[2];
		return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
	}

	function visibleBoard(board) {
		var r = board.getBoundingClientRect();
		var left = Math.max(r.left, 0);
		var top = Math.max(r.top, 0);
		var right = Math.min(r.right, window.innerWidth || r.right);
		var bottom = Math.min(r.bottom, window.innerHeight || r.bottom);
		if (right < left) right = left;
		if (bottom < top) bottom = top;
		return { left: left - r.left, top: top - r.top, right: right - r.left, bottom: bottom - r.top };
	}

	function placeChips() {
		var board = document.getElementById("box");
		var chips = document.getElementById("livePredictChips");
		var bar, nodes, i, poly, rect, node, text, cw, ch, gap, margin, view, left, top, barW, barH;
		if (!board || !chips) return;
		view = visibleBoard(board);
		margin = 4;
		gap = 6;
		bar = document.getElementById("livePredictBar");
		barW = bar ? bar.offsetWidth : 0;
		barH = bar ? bar.offsetHeight : 0;
		nodes = chips.children;
		for (i = 0; i < nodes.length; i++) {
			node = nodes[i];
			poly = polyById(node.getAttribute("data-id"));
			if (!poly) continue;
			text = node.querySelector(".liveChipText");
			if (text) text.textContent = chipText(poly);
			rect = boxScreen(poly);
			if (!rect) continue;
			cw = node.offsetWidth || 160;
			ch = node.offsetHeight || 28;
			left = rect.left + rect.width + gap;
			if (left + cw > view.right - margin) left = rect.left - gap - cw;
			if (left < view.left + margin) left = rect.left + gap;
			if (left + cw > view.right - margin) left = view.right - margin - cw;
			if (left < view.left + margin) left = view.left + margin;
			top = rect.top;
			if (top + ch > view.bottom - margin) top = rect.top - gap - ch;
			if (top < view.top + margin) top = rect.top + Math.max(0, rect.height - ch);
			if (top + ch > view.bottom - margin) top = view.bottom - margin - ch;
			if (top < view.top + margin) top = view.top + margin;
			if (bar && left < 8 + barW && top < 8 + barH && left + cw > 8 && top + ch > 8) {
				if (8 + barH + gap + ch <= view.bottom - margin) top = 8 + barH + gap;
			}
			node.style.left = Math.round(left) + "px";
			node.style.top = Math.round(top) + "px";
		}
	}

	function startFollow() {
		if (followTimer) return;
		followTimer = setInterval(placeChips, 200);
	}

	function alive(poly) {
		return !!(poly && brd && brd.objects && brd.objects[poly.id]);
	}

	function onAccessError(err) {
		if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
			connected = false;
			stopPoll();
			paint();
		}
	}

	function readNamed(name) {
		return dirHandle.getFileHandle(name).then(function (file) {
			return file.getFile();
		}).then(function (file) {
			return readText(file);
		});
	}

	function pollPredictions(opts) {
		var quiet = !!(opts && opts.quiet);
		return readNamed(PRED_FILE).then(function (text) {
			var cover;
			if (!connected) return;
			if (text === predText) {
				paintFramePredict();
				paintPrepare();
				return;
			}
			predText = text;
			try { predictions = JSON.parse(text); }
			catch (e) {
				predictions = null;
				if (predWarned !== text) {
					predWarned = text;
					note("το αρχείο προβλέψεων δεν είναι έγκυρο json");
				}
				paintFramePredict();
				paintTrainer();
				return;
			}
			predWarned = "";
			if (quiet && !hasUserAnnotations()) clearShownPredictions();
			if (!predictionsApply()) {
				clearShownPredictions();
				paintFramePredict();
				paintTrainer();
				return;
			}
			if (!shown.length) dismiss = false;
			showForCurrent();
			paintFramePredict();
			paintTrainer();
			if (quiet || prepareShown || (readyToastAt && Date.now() - readyToastAt < 4000)) return;
			cover = predictionCoverage();
			toast(cover ? "νέες προβλέψεις: frames " + cover.from + (cover.from === cover.to ? "" : "–" + cover.to) : "νέες προβλέψεις");
		}).catch(function (err) {
			if (err && (err.name === "NotFoundError" || err.name === "TypeError")) {
				if (predText) {
					predText = "";
					predictions = null;
					paintFramePredict();
					paintTrainer();
				}
				return;
			}
			onAccessError(err);
		});
	}

	function pollStatus() {
		return readNamed(STATUS_FILE).then(function (text) {
			if (!connected) return;
			if (text === statusText) return;
			statusText = text;
			if (!String(text || "").trim()) {
				trainerDoc = null;
				trainerBad = false;
				paintTrainer();
				return;
			}
			try {
				trainerDoc = JSON.parse(text);
				trainerBad = !trainerDoc || typeof trainerDoc !== "object";
				if (trainerBad) trainerDoc = null;
			} catch (e) {
				trainerDoc = null;
				trainerBad = true;
			}
			paintTrainer();
			paintFramePredict();
		}).catch(function (err) {
			if (err && (err.name === "NotFoundError" || err.name === "TypeError")) {
				if (statusText !== null || trainerDoc || trainerBad) {
					statusText = null;
					trainerDoc = null;
					trainerBad = false;
					paintTrainer();
				}
				return;
			}
			onAccessError(err);
		});
	}

	function poll() {
		if (!connected || !dirHandle) return Promise.resolve();
		var run = function () {
			if (!connected || !dirHandle) return;
			return Promise.all([pollPredictions(), pollStatus()]);
		};
		pollChain = pollChain.then(run, run);
		return pollChain;
	}

	function startPoll() {
		stopPoll();
		poll();
		pollTimer = setInterval(poll, POLL_MS);
	}

	function stopPoll() {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = null;
	}

	function autoAcceptOn() {
		var box = document.getElementById("autoAccept");
		if (box) return !!box.checked;
		try { return localStorage.getItem("annotool.autoAccept") !== "0"; }
		catch (e) { return true; }
	}

	function bindAutoAccept() {
		var box = document.getElementById("autoAccept");
		if (!box || box._syncBound) return;
		var stored = null;
		try { stored = localStorage.getItem("annotool.autoAccept"); } catch (e) {}
		if (stored === "0") box.checked = false;
		box.addEventListener("change", function () {
			try { localStorage.setItem("annotool.autoAccept", box.checked ? "1" : "0"); } catch (e) {}
		});
		box._syncBound = true;
	}

	function hookNamed(name, flag) {
		var fn = window[name];
		if (typeof fn !== "function" || fn._syncNav) return;
		window[name] = function () {
			if (imReadFlag) return fn.apply(this, arguments);
			window[flag] = true;
			var result = fn.apply(this, arguments);
			if (!imReadFlag) window[flag] = false;
			return result;
		};
		window[name]._syncNav = true;
	}

	function arrived(left) {
		ensureReviewed();
		if (skipLeave || window.__liveSkipLeave) {
			skipLeave = false;
			window.__liveSkipLeave = false;
			left = "";
			dismiss = false;
			shown = [];
			clearUi();
		}
		window.__liveReviewLeave = false;
		if (left && left !== imName) {
			addReviewed(left);
			dismiss = false;
			shown = [];
			clearUi();
		}
		if (typeof imName !== "undefined" && imName) removeReviewed(imName);
		paintFramePredict();
		poll().then(function () {
			showForCurrent();
			paintFramePredict();
		});
		scheduleChange();
	}

	function hookPair(prepName, afterName) {
		var prep = window[prepName];
		var after = window[afterName];
		if (typeof prep === "function" && !prep._syncLeave) {
			window[prepName] = function () {
				var review = prepName === "prepareChangeImg" && window.__liveReviewLeave && !window.__liveSkipLeave && !skipLeave;
				window.__liveLeaving = (typeof imName !== "undefined") ? imName : "";
				window.__liveReviewLeave = false;
				if (review && autoAcceptOn()) acceptAll();
				return prep.apply(this, arguments);
			};
			window[prepName]._syncLeave = true;
		}
		if (typeof after === "function" && !after._syncArrive) {
			window[afterName] = function () {
				var left = window.__liveLeaving || "";
				window.__liveLeaving = "";
				var result = after.apply(this, arguments);
				drawnFor = (typeof imName !== "undefined" && imName) ? imName : "";
				boardDirty = false;
				arrived(left);
				return result;
			};
			window[afterName]._syncArrive = true;
		}
	}

	function hookStore() {
		if (typeof storeAnnotationImg !== "function" || storeAnnotationImg._syncWrapped) return;
		var orig = storeAnnotationImg;
		window.storeAnnotationImg = function () {
			if (!flushing) boardDirty = true;
			var result = orig.apply(this, arguments);
			if (boardDirty && drawnFor && typeof imName !== "undefined" && drawnFor === imName && annotationCount(allAnnotations && allAnnotations.images) === 0) allowEmptyWrite = true;
			if (!flushing) scheduleChange();
			return result;
		};
		window.storeAnnotationImg._syncWrapped = true;
	}

	function hookRemove() {
		if (typeof removePolygon !== "function" || removePolygon._syncWrapped) return;
		var orig = removePolygon;
		window.removePolygon = function (poly) {
			var was = poly && poly._liveSuggest;
			if (was && !clearingPredictions) recordRejection(poly);
			if (!was && !clearingPredictions) boardDirty = true;
			if (was) dropShown(poly);
			var result = orig.apply(this, arguments);
			if (was && !clearingPredictions) {
				if (!shown.length) { dismiss = true; clearUi(); }
				else renderUi();
			}
			return result;
		};
		window.removePolygon._syncWrapped = true;
	}

	function hookRemoveAll() {
		if (typeof removeAllObj !== "function" || removeAllObj._syncWrapped) return;
		var orig = removeAllObj;
		window.removeAllObj = function () {
			var had = shown.length > 0;
			var result = orig.apply(this, arguments);
			if (had) {
				shown = [];
				clearUi();
				dismiss = true;
			}
			return result;
		};
		window.removeAllObj._syncWrapped = true;
	}

	function resurface() {
		dismiss = false;
		shown = [];
		clearUi();
		showForCurrent();
		paintFramePredict();
	}

	function editableTarget(el) {
		if (!el) return false;
		var tag = (el.tagName || "").toLowerCase();
		if (tag === "input" || tag === "textarea" || tag === "select") return true;
		if (el.isContentEditable) return true;
		return false;
	}

	function bindUi() {
		var btn = document.getElementById("liveSyncBtn");
		var hits = document.getElementById("hits");
		if (btn) {
			btn.addEventListener("click", function () {
				if (!supported()) return;
				if (connected) { disconnect(); return; }
				connectSavedOrPick().catch(ignoreAbort);
			});
			btn.addEventListener("contextmenu", function (e) {
				if (!supported()) return;
				e.preventDefault();
				if (connected) disconnect();
				savedHandle = null;
				pickDirectory().then(connectHandle).catch(ignoreAbort);
			});
		}
		document.addEventListener("pointerup", function (e) {
			if (!connected || editableTarget(e.target)) return;
			if (e.target && e.target.closest && e.target.closest("#liveSync")) return;
			scheduleChange();
		}, true);
		document.addEventListener("keyup", function (e) {
			if (!connected || editableTarget(e.target)) return;
			scheduleChange();
		}, true);
		if (hits) hits.addEventListener("change", scheduleChange);
		var mapBtn = document.getElementById("mapGlanceOpen");
		var mapClose = document.getElementById("mapPanelClose");
		if (mapBtn && !mapBtn._syncBound) {
			mapBtn._syncBound = true;
			mapBtn.addEventListener("click", function () {
				toggleMapPanel();
				this.blur();
			});
		}
		if (mapClose && !mapClose._syncBound) {
			mapClose._syncBound = true;
			mapClose.addEventListener("click", function () { setMapPanel(false); });
		}
		var modelSel = document.getElementById("liveModelChoice");
		var modelText = document.getElementById("liveModelFromText");
		if (modelSel && !modelSel._syncBound) {
			modelSel.addEventListener("change", onModelInput);
			modelSel._syncBound = true;
		}
		if (modelText && !modelText._syncBound) {
			modelText.addEventListener("input", onModelInput);
			modelText._syncBound = true;
		}
	}

	function restoreHandle() {
		idbGet("dir").then(function (handle) {
			if (!handle) { paint(); return; }
			savedHandle = handle;
			return permission(handle, false).then(function (state) {
				paint();
				if (state === "granted") return connectHandle(handle);
			});
		}).catch(function () { paint(); });
	}

	function boot() {
		if (typeof checkLoadLocalStorage === "function") {
			try { checkLoadLocalStorage(); } catch (e) {}
		}
		paint();
		bindAutoAccept();
		hookNamed("loadNextImg", "__liveReviewLeave");
		hookNamed("loadPrevImg", "__liveReviewLeave");
		hookNamed("loadNext10Img", "__liveSkipLeave");
		hookPair("prepareChangeImg", "afterChangeImg");
		hookPair("filter_prepareChangeImg", "filter_afterChangeImg");
		hookStore();
		hookRemove();
		hookRemoveAll();
		bindUi();
		initMapPanel();
		if (!supported()) return;
		restoreHandle();
	}

	window.AnnoSync = {
		connectHandle: connectHandle,
		disconnect: disconnect,
		flush: function () { return flush(true); },
		noteHydrated: function () {
			storageReady = true;
			hydratedProject = currentProject();
			hydratedImages = null;
			if (typeof allAnnotations !== "undefined" && allAnnotations && allAnnotations.images) {
				try { hydratedImages = JSON.parse(JSON.stringify(allAnnotations.images)); } catch (e) { hydratedImages = null; }
			}
		},
		noteCleared: function () {
			userCleared = true;
			allowEmptyWrite = true;
			hydratedImages = null;
			hydratedProject = "";
			navReviews = 0;
			reviewed = [];
			if (reviewedLoaded) saveReviewed();
			liveReviewedAdopted = true;
		},
		onAutosave: function () { return flush(true); },
		noteChange: scheduleChange,
		pollNow: poll,
		noteProject: noteProject,
		resurface: resurface,
		status: function () {
			ensureReviewed();
			return {
				connected: connected,
				folder: (dirHandle && dirHandle.name) || "",
				reviewed: reviewed.slice()
			};
		}
	};

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
	else boot();
})();
