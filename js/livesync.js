(function () {
	var LIVE_FILE = "annotool_live.json";
	var PRED_FILE = "annotool_predictions.json";
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
	var flushing = false;
	var lastBody = "";
	var predictions = null;
	var predText = "";
	var predWarned = "";
	var dismiss = false;
	var shown = [];
	var reviewed = [];
	var reviewedProject = null;
	var reviewedLoaded = false;

	function supported() {
		return !!(window.showDirectoryPicker && window.indexedDB);
	}

	function currentProject() {
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

	function ensureReviewed() {
		var project = currentProject();
		if (reviewedLoaded && project === reviewedProject) return;
		if (reviewedLoaded) saveReviewed();
		reviewedProject = project;
		reviewed = [];
		reviewedLoaded = true;
		try {
			var raw = localStorage.getItem(reviewKey());
			var arr = raw ? JSON.parse(raw) : [];
			if (Object.prototype.toString.call(arr) === "[object Array]") {
				for (var i = 0; i < arr.length; i++) if (typeof arr[i] === "string" && arr[i]) reviewed.push(arr[i]);
			}
		} catch (e) {}
	}

	function addReviewed(name) {
		if (!name) return;
		ensureReviewed();
		if (reviewed.indexOf(name) === -1) reviewed.push(name);
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

	function paint() {
		var root = document.getElementById("liveSync");
		var btn = document.getElementById("liveSyncBtn");
		var state = document.getElementById("liveSyncState");
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
		ensureReviewed();
		flushing = true;
		try { if (typeof storeAnnotationImg === "function") storeAnnotationImg(); }
		catch (e) {}
		flushing = false;
		var payload = JSON.parse(JSON.stringify(allAnnotations));
		if (typeof imName !== "undefined" && imName) payload.currentImage = imName;
		payload.syncedAt = new Date().toISOString();
		payload.currentImageIndex = (typeof imIndex === "number") ? imIndex : null;
		payload.reviewed = reviewed.slice();
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

	function flush(force) {
		if (!connected || !dirHandle) return Promise.resolve();
		clearTimeout(timer);
		var run = function () {
			if (!connected || !dirHandle) return;
			var text;
			try { text = buildLiveText(); }
			catch (e) { return; }
			var body = bodyOf(text);
			if (!force && body === lastBody) return;
			return writeAtomic(dirHandle, LIVE_FILE, text).then(function () { lastBody = body; });
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
			if (!doc || !doc.reviewed || !doc.reviewed.length) return;
			ensureReviewed();
			for (var i = 0; i < doc.reviewed.length; i++) {
				if (typeof doc.reviewed[i] === "string" && reviewed.indexOf(doc.reviewed[i]) === -1) reviewed.push(doc.reviewed[i]);
			}
			saveReviewed();
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
		return absorbFileReviewed().then(function () { return flush(true); });
	}

	function disconnect() {
		connected = false;
		clearTimeout(timer);
		stopPoll();
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

	function findFrame(doc, name) {
		if (!doc || !doc.images || !name) return null;
		var images = doc.images;
		if (images[name] && images[name].annotations) return images[name];
		var bare = (typeof bareImageName === "function") ? bareImageName(name) : name;
		if (bare !== name && images[bare] && images[bare].annotations) return images[bare];
		var stem = stemOf(name);
		var key, img, label, loose = null;
		for (key in images) {
			if (!images.hasOwnProperty(key) || !images[key]) continue;
			img = images[key];
			label = img.imageName || key;
			if (label === name || key === name) return img;
			if (stemOf(label) === stem || stemOf(key) === stem) { if (!loose) loose = img; }
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

	function showForCurrent() {
		var frame, list, i, poly, n;
		if (!connected || dismiss) return;
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
			if (poly) shown.push(poly);
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

	function placeChips() {
		var board = document.getElementById("box");
		var chips = document.getElementById("livePredictChips");
		var nodes, i, poly, rect, node, left, top;
		if (!board || !chips) return;
		nodes = chips.children;
		for (i = 0; i < nodes.length; i++) {
			node = nodes[i];
			poly = polyById(node.getAttribute("data-id"));
			if (!poly) continue;
			var text = node.querySelector(".liveChipText");
			if (text) text.textContent = chipText(poly);
			rect = boxScreen(poly);
			if (!rect) continue;
			left = rect.left + rect.width + 6;
			top = rect.top;
			if (left + 180 > board.clientWidth) left = Math.max(4, rect.left - 8);
			if (top < 36) top = 36;
			if (top > board.clientHeight - 28) top = Math.max(36, board.clientHeight - 28);
			node.style.left = left + "px";
			node.style.top = top + "px";
		}
	}

	function startFollow() {
		if (followTimer) return;
		followTimer = setInterval(placeChips, 200);
	}

	function alive(poly) {
		return !!(poly && brd && brd.objects && brd.objects[poly.id]);
	}

	function poll() {
		if (!connected || !dirHandle) return Promise.resolve();
		return dirHandle.getFileHandle(PRED_FILE).then(function (file) {
			return file.getFile();
		}).then(function (file) {
			return readText(file);
		}).then(function (text) {
			if (text === predText) return;
			predText = text;
			try { predictions = JSON.parse(text); }
			catch (e) {
				predictions = null;
				if (predWarned !== text) {
					predWarned = text;
					note("το αρχείο προβλέψεων δεν είναι έγκυρο json");
				}
				return;
			}
			predWarned = "";
			if (!shown.length) dismiss = false;
			showForCurrent();
		}).catch(function (err) {
			if (err && (err.name === "NotFoundError" || err.name === "TypeError")) return;
			if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
				connected = false;
				stopPoll();
				paint();
			}
		});
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

	function arrived(left) {
		ensureReviewed();
		if (left && left !== imName) {
			addReviewed(left);
			dismiss = false;
			shown = [];
			clearUi();
		}
		if (typeof imName !== "undefined" && imName) removeReviewed(imName);
		poll().then(showForCurrent);
		scheduleChange();
	}

	function hookPair(prepName, afterName) {
		var prep = window[prepName];
		var after = window[afterName];
		if (typeof prep === "function" && !prep._syncLeave) {
			window[prepName] = function () {
				window.__liveLeaving = (typeof imName !== "undefined") ? imName : "";
				return prep.apply(this, arguments);
			};
			window[prepName]._syncLeave = true;
		}
		if (typeof after === "function" && !after._syncArrive) {
			window[afterName] = function () {
				var left = window.__liveLeaving || "";
				window.__liveLeaving = "";
				var result = after.apply(this, arguments);
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
			var result = orig.apply(this, arguments);
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
			if (was) dropShown(poly);
			var result = orig.apply(this, arguments);
			if (was) {
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
		paint();
		hookPair("prepareChangeImg", "afterChangeImg");
		hookPair("filter_prepareChangeImg", "filter_afterChangeImg");
		hookStore();
		hookRemove();
		hookRemoveAll();
		bindUi();
		if (!supported()) return;
		restoreHandle();
	}

	window.AnnoSync = {
		connectHandle: connectHandle,
		disconnect: disconnect,
		flush: function () { return flush(true); },
		onAutosave: function () { return flush(true); },
		noteChange: scheduleChange,
		pollNow: poll,
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
