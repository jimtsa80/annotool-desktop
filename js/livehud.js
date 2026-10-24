(function () {
	var SEP = "\u0001";
	var TARGETS_KEY = "annotool.comboTargets";
	var LOCK_KEY = "annotool.comboLocks";
	var METRIC_KEY = "annotool.comboMetric";
	var OPEN_KEY = "annotool.comboPanelOpen";
	var POS_KEY = "annotool.comboPanelPos";

	var metric = "boxes";
	var query = "";
	var captionsOn = false;
	var capRaf = 0;
	var capNodes = {};
	var rowEls = {};
	var watchedKey = "";
	var manualWatch = false;
	var drag = null;

	function fmt(n) {
		n = n || 0;
		try { return n.toLocaleString("el-GR"); }
		catch (e) { return String(n); }
	}

	function projectKey() {
		var name = "";
		if (typeof prefs !== "undefined" && prefs && prefs.projectRoot) name = prefs.projectRoot;
		else if (typeof prefs !== "undefined" && prefs && prefs.projectName) name = prefs.projectName;
		else if (typeof allAnnotations !== "undefined" && allAnnotations && allAnnotations.project) name = allAnnotations.project;
		return name || "_";
	}

	function loadJson(key) {
		try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; }
		catch (e) { return {}; }
	}

	function targetsForProject() {
		var all = loadJson(TARGETS_KEY);
		return all[projectKey()] || {};
	}

	function setTarget(key, value) {
		var all = loadJson(TARGETS_KEY);
		var pk = projectKey();
		if (!all[pk]) all[pk] = {};
		if (value === "" || value === null || isNaN(value)) delete all[pk][key];
		else all[pk][key] = value;
		try { localStorage.setItem(TARGETS_KEY, JSON.stringify(all)); }
		catch (e) {}
	}

	function locksForProject() {
		var all = loadJson(LOCK_KEY);
		var list = all[projectKey()];
		return Array.isArray(list) ? list : [];
	}

	function setLocks(list) {
		var all = loadJson(LOCK_KEY);
		var pk = projectKey();
		if (!list || !list.length) delete all[pk];
		else all[pk] = list;
		try { localStorage.setItem(LOCK_KEY, JSON.stringify(all)); }
		catch (e) {}
	}

	function toggleLock(key) {
		var list = locksForProject();
		var at = list.indexOf(key);
		if (at >= 0) list.splice(at, 1);
		else list.push(key);
		setLocks(list);
	}

	function lockedCombos() {
		var list = locksForProject();
		var out = [], i, parts;
		for (i = 0; i < list.length; i++) {
			parts = list[i].split(SEP);
			out.push({ brand: (parts[0] || "").trim(), location: parts.slice(1).join(SEP).trim() });
		}
		return out;
	}

	function comboKey(brand, location) {
		return (brand || "") + SEP + (location || "");
	}

	function useLiveBoard() {
		return typeof brd !== "undefined" && brd && brd.objectsList &&
			typeof imName !== "undefined" && imName && !imReadFlag;
	}

	function addCount(map, brand, location, hits, onThisFrame) {
		brand = (brand || "").trim();
		location = (location || "").trim();
		if (!brand || !location) return;
		var key = comboKey(brand, location);
		if (!map[key]) map[key] = { key: key, brand: brand, location: location, boxes: 0, hits: 0, here: 0 };
		map[key].boxes += 1;
		map[key].hits += parseInt(hits, 10) || 0;
		if (onThisFrame) map[key].here += 1;
	}

	function eachBoardPolygon(fn) {
		if (!brd || !brd.objectsList) return;
		var list = brd.objectsList;
		for (var i = 0; i < list.length; i++) {
			var o = list[i];
			if (!o || o.elType !== "polygon") continue;
			if (o.visProp && o.visProp.visible === false) continue;
			fn(o);
		}
	}

	function collect() {
		var map = {};
		var live = useLiveBoard();
		var images = (typeof allAnnotations !== "undefined" && allAnnotations && allAnnotations.images) || {};
		for (var name in images) {
			if (!images.hasOwnProperty(name)) continue;
			if (live && name === imName) continue;
			var anns = images[name].annotations || [];
			for (var i = 0; i < anns.length; i++) {
				addCount(map, anns[i].brand, anns[i].tpoint, anns[i].hits, false);
			}
		}
		if (live) {
			eachBoardPolygon(function (o) {
				var a = o.annotation || {};
				addCount(map, a.brand, a.tpoint, a.hits, true);
			});
		}
		return map;
	}

	function listSelection() {
		var id = $("#brands ul li.brand.selected").attr("id") || "";
		var parts = id.split("__");
		var brand = parts.length > 1 ? parts.slice(1).join("__") : "";
		var location = ($("#tpoints ul li.selected").text() || "").trim();
		if (!brand || !location) return null;
		return { brand: brand, location: location };
	}

	function boxSelection() {
		if (typeof highlighted === "undefined" || !highlighted || highlighted.length !== 1) return null;
		var a = highlighted[0] && highlighted[0].annotation;
		if (!a || !(a.brand || "").trim() || !(a.tpoint || "").trim()) return null;
		return { brand: a.brand.trim(), location: a.tpoint.trim() };
	}

	function activeCombo() {
		return boxSelection() || listSelection();
	}

	function decorate(row, targets) {
		var value = metric === "hits" ? row.hits : row.boxes;
		var target = parseInt(targets[row.key], 10);
		if (!target) target = 0;
		var state = "";
		var pct = 0;
		var hint = "";
		if (target) {
			pct = Math.max(0, Math.min(100, Math.round(value / target * 100)));
			var diff = target - value;
			if (diff > 0) { state = value >= target * 0.85 ? "near" : "ok"; hint = "λείπουν " + fmt(diff); }
			else if (diff < 0) { state = "over"; hint = "πάνω " + fmt(-diff); }
			else { state = "near"; hint = "ακριβώς στον στόχο"; }
		}
		row.value = value;
		row.target = target;
		row.state = state;
		row.pct = pct;
		row.hint = hint;
		row.other = metric === "hits" ? (fmt(row.boxes) + " τετράγωνα") : ("hits " + fmt(row.hits));
		return row;
	}

	function sortedRows(map) {
		var targets = targetsForProject();
		var rows = [];
		for (var k in map) if (map.hasOwnProperty(k)) rows.push(decorate(map[k], targets));
		rows.sort(function (a, b) {
			if ((a.here > 0) !== (b.here > 0)) return a.here > 0 ? -1 : 1;
			if (b.value !== a.value) return b.value - a.value;
			return (a.brand + a.location).localeCompare(b.brand + b.location);
		});
		return rows;
	}

	function buildRow(row) {
		var el = document.createElement("div");
		el.className = "combo-row";
		el._comboKey = row.key;
		el.innerHTML =
			'<div class="combo-bar"></div>' +
			'<div class="combo-main"><button type="button" class="combo-lock" title="κλείδωσε για να βλέπεις μόνο αυτό">κλείδωμα</button><span class="combo-name"></span><span class="combo-num"></span></div>' +
			'<div class="combo-meta"><span class="combo-here"></span><span class="combo-sub"></span>' +
			'<label class="combo-target-label">στόχος <input class="combo-target" type="number" min="0" step="1"></label></div>';
		return el;
	}

	function updateRow(el, row) {
		el.querySelector(".combo-name").textContent = row.brand + " | " + row.location;
		el.querySelector(".combo-num").textContent = row.target ? (fmt(row.value) + " / " + fmt(row.target)) : fmt(row.value);
		var sub = row.hint ? (row.hint + " · " + row.other) : row.other;
		el.querySelector(".combo-sub").textContent = sub;
		var here = el.querySelector(".combo-here");
		if (row.here) {
			here.style.display = "";
			here.textContent = row.here > 1 ? ("εδώ " + row.here) : "εδώ";
		} else {
			here.style.display = "none";
		}
		var input = el.querySelector(".combo-target");
		if (document.activeElement !== input) input.value = row.target ? String(row.target) : "";
		el.querySelector(".combo-bar").style.width = (row.target ? row.pct : 0) + "%";
		el.classList.toggle("is-over", row.state === "over");
		el.classList.toggle("is-near", row.state === "near");
		el.classList.toggle("is-ok", row.state === "ok");
		el.classList.toggle("is-here", row.here > 0);
		el.classList.toggle("is-watched", row.key === watchedKey);
		var locked = locksForProject();
		var held = locked.indexOf(row.key) !== -1;
		el.classList.toggle("is-locked", held);
		var lockBtn = el.querySelector(".combo-lock");
		if (lockBtn) {
			lockBtn.classList.toggle("on", held);
			lockBtn.textContent = held ? "βγάλτο" : "κλείδωμα";
		}
		var q = query.trim().toLowerCase();
		var blob = (row.brand + " " + row.location).toLowerCase();
		var matchesQuery = !q || blob.indexOf(q) !== -1;
		el.style.display = matchesQuery && (!locked.length || held) ? "" : "none";
	}

	function paintList(rows) {
		var list = document.getElementById("comboList");
		var empty = document.getElementById("comboEmpty");
		var seen = {};
		var visible = 0;
		var freeze = document.activeElement && list.contains(document.activeElement);
		for (var i = 0; i < rows.length; i++) {
			var row = rows[i];
			seen[row.key] = true;
			var el = rowEls[row.key];
			if (!el) {
				el = buildRow(row);
				rowEls[row.key] = el;
				list.appendChild(el);
			}
			updateRow(el, row);
			if (el.style.display !== "none") visible += 1;
		}
		for (var key in rowEls) {
			if (!rowEls.hasOwnProperty(key) || seen[key]) continue;
			if (document.activeElement && rowEls[key].contains(document.activeElement)) continue;
			if (rowEls[key].parentNode) rowEls[key].parentNode.removeChild(rowEls[key]);
			delete rowEls[key];
		}
		if (!freeze) {
			for (var j = 0; j < rows.length; j++) {
				var node = rowEls[rows[j].key];
				if (node && list.children[j] !== node) list.insertBefore(node, list.children[j] || null);
			}
		}
		var count = document.getElementById("comboPanelCount");
		if (count) {
			var lockedCount = locksForProject().length;
			count.textContent = lockedCount ? (lockedCount + " κλειδωμένα") : (rows.length ? (rows.length + "") : "");
		}
		var clearBtn = document.getElementById("comboLockClear");
		if (clearBtn) clearBtn.classList.toggle("on", locksForProject().length > 0);
		if (empty) {
			empty.style.display = visible ? "none" : "block";
			empty.textContent = rows.length ? "Κανένα αποτέλεσμα." : "Ακόμα δεν υπάρχει κανένας συνδυασμός.";
		}
	}

	function fillPick(rows) {
		var pick = document.getElementById("comboPick");
		if (!pick) return;
		var sig = [];
		for (var i = 0; i < rows.length; i++) sig.push(rows[i].key);
		sig = sig.join("\n");
		if (pick.getAttribute("data-sig") !== sig && document.activeElement !== pick) {
			pick.innerHTML = "";
			var all = document.createElement("option");
			all.value = "";
			all.textContent = rows.length ? "όλοι οι συνδυασμοί" : "κανένας συνδυασμός";
			pick.appendChild(all);
			for (var j = 0; j < rows.length; j++) {
				var opt = document.createElement("option");
				opt.value = rows[j].key;
				opt.textContent = rows[j].brand + " | " + rows[j].location;
				pick.appendChild(opt);
			}
			pick.setAttribute("data-sig", sig);
		}
		if (document.activeElement === pick) return;
		var want = watchedKey || "";
		var found = want === "";
		if (!found) {
			for (var n = 0; n < pick.options.length; n++) {
				if (pick.options[n].value === want) { found = true; break; }
			}
		}
		if (!found && want) {
			var bits = want.split(SEP);
			var extra = document.createElement("option");
			extra.value = want;
			extra.textContent = (bits[0] || "") + " | " + bits.slice(1).join(SEP);
			pick.appendChild(extra);
			found = true;
		}
		pick.value = found ? want : "";
	}

	function paintGlance(map, rows) {
		var glance = document.getElementById("comboGlance");
		var numEl = document.getElementById("comboGlanceNum");
		var hintEl = document.getElementById("comboGlanceHint");
		var bar = document.getElementById("comboGlanceBar");
		if (!glance || !numEl) return;

		fillPick(lockedCount ? rows.filter(function (row) { return locksForProject().indexOf(row.key) !== -1; }) : rows);
		var row = watchedKey && map[watchedKey] ? decorate(map[watchedKey], targetsForProject()) : null;
		if (!row && watchedKey) {
			var parts = watchedKey.split(SEP);
			row = decorate({
				key: watchedKey, brand: parts[0] || "", location: parts.slice(1).join(SEP),
				boxes: 0, hits: 0, here: 0
			}, targetsForProject());
		}

		glance.classList.remove("is-near", "is-over", "is-ok");
		var lockedCount = locksForProject().length;
		if (!row) {
			var boxes = 0, hits = 0;
			for (var i = 0; i < rows.length; i++) { boxes += rows[i].boxes; hits += rows[i].hits; }
			numEl.textContent = rows.length ? fmt(metric === "hits" ? hits : boxes) : "";
			hintEl.textContent = rows.length
				? ((lockedCount ? ("κλειδωμένα " + lockedCount + " · ") : "") + (metric === "hits" ? (fmt(boxes) + " τετράγωνα") : ("hits " + fmt(hits))))
				: (lockedCount ? ("κλειδωμένα " + lockedCount) : "");
			bar.className = "";
			return;
		}

		if (row.state) glance.classList.add("is-" + row.state);
		numEl.textContent = row.target ? (fmt(row.value) + " / " + fmt(row.target)) : fmt(row.value);
		var unit = metric === "hits" ? "hits" : "τετράγωνα";
		var hereBit = row.here ? (" · εδώ " + row.here) : "";
		hintEl.textContent = (lockedCount ? ("κλειδωμένα " + lockedCount + " · ") : "") + (row.hint ? row.hint + " · " : "") + unit + " · " + row.other + hereBit;
		if (row.target) {
			bar.className = "on";
			bar.querySelector("i").style.width = row.pct + "%";
		} else {
			bar.className = "";
		}
	}

	function currentFrameAnnotated() {
		var found = false;
		eachBoardPolygon(function (o) {
			var a = o.annotation || {};
			if ((a.brand || "").trim() && (a.tpoint || "").trim()) found = true;
		});
		return found;
	}

	function paintRemaining() {
		var el = document.getElementById("howmanyleft");
		if (!el) return;
		if (typeof imIndices === "undefined" || !imIndices || !imIndices.length) {
			el.textContent = "";
			el.title = "";
			return;
		}
		var total = imIndices.length;
		var index = (typeof imIndex === "number" && imIndex >= 0) ? imIndex : 0;
		var ahead = Math.max(0, total - index);
		var bare = 0;
		var images = (typeof allAnnotations !== "undefined" && allAnnotations && allAnnotations.images) || {};
		var live = useLiveBoard();
		var liveDone = live && currentFrameAnnotated();
		for (var i = 0; i < total; i++) {
			var name = imIndices[i];
			if (live && name === imName) {
				if (!liveDone) bare++;
				continue;
			}
			var stored = images[name] && images[name].annotations && images[name].annotations.length;
			if (!stored) bare++;
		}
		var text = "απομένουν " + fmt(ahead) + " · χωρίς annotation " + fmt(bare);
		var tip = "Από αυτή την εικόνα ως το τέλος: " + ahead + ". Εικόνες χωρίς κουτί: " + bare + " από " + total + ".";
		if (el.textContent !== text) el.textContent = text;
		if (el.title !== tip) el.title = tip;
	}

	function refresh() {
		if (!manualWatch) {
			var follow = listSelection() || boxSelection();
			if (follow) watchedKey = comboKey(follow.brand, follow.location);
		}
		var map = collect();
		var rows = sortedRows(map);
		paintList(rows);
		paintGlance(map, rows);
		paintRemaining();
		paintLockFocus();
	}

	function paintLockFocus() {
		if (typeof brd === "undefined" || !brd) return;
		var locked = locksForProject();
		var on = locked.length > 0;
		eachBoardPolygon(function (o) {
			var a = o.annotation || {};
			var key = comboKey((a.brand || "").trim(), (a.tpoint || "").trim());
			var fade = on && locked.indexOf(key) === -1;
			var op = fade ? "0.14" : "";
			if (o.rendNode) o.rendNode.style.opacity = op;
			if (o.borders) {
				for (var b in o.borders) {
					if (o.borders[b] && o.borders[b].rendNode) o.borders[b].rendNode.style.opacity = op;
				}
			}
		});
	}

	function setMetric(next) {
		metric = next === "hits" ? "hits" : "boxes";
		try { localStorage.setItem(METRIC_KEY, metric); } catch (e) {}
		var buttons = document.querySelectorAll("#comboMetric button");
		for (var i = 0; i < buttons.length; i++) {
			buttons[i].classList.toggle("on", buttons[i].getAttribute("data-metric") === metric);
		}
		refresh();
	}

	function placePanel() {
		var panel = document.getElementById("comboPanel");
		if (!panel) return;
		var saved = loadJson(POS_KEY);
		if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
			var maxLeft = Math.max(8, window.innerWidth - 80);
			var maxTop = Math.max(8, window.innerHeight - 80);
			panel.style.left = Math.max(8, Math.min(saved.left, maxLeft)) + "px";
			panel.style.top = Math.max(8, Math.min(saved.top, maxTop)) + "px";
			panel.style.right = "auto";
			return;
		}
		var gutter = (window.innerWidth - 1360) / 2;
		panel.style.top = "132px";
		if (gutter >= 300) {
			panel.style.right = "12px";
			panel.style.left = "auto";
		} else {
			panel.style.right = "12px";
			panel.style.left = "auto";
		}
	}

	function setPanel(open) {
		var panel = document.getElementById("comboPanel");
		if (!panel) return;
		if (open) placePanel();
		panel.classList.toggle("open", !!open);
		panel.setAttribute("aria-hidden", open ? "false" : "true");
		var btn = document.getElementById("btn_combos");
		if (btn) btn.classList.toggle("on", !!open);
		try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch (e) {}
		if (open) refresh();
	}

	function togglePanel() {
		var panel = document.getElementById("comboPanel");
		setPanel(!(panel && panel.classList.contains("open")));
	}

	function screenPoint(x, y) {
		try {
			var c = new JXG.Coords(JXG.COORDS_BY_USER, [x, y], brd);
			return { x: c.scrCoords[1], y: c.scrCoords[2] };
		} catch (e) {
			return null;
		}
	}

	function topLeft(poly) {
		var parents = poly.getParents ? poly.getParents() : [];
		var minX = Infinity, minY = Infinity;
		for (var i = 0; i < parents.length; i++) {
			var p = brd.objects[parents[i]];
			if (!p || typeof p.X !== "function") continue;
			var s = screenPoint(p.X(), p.Y());
			if (!s) continue;
			if (s.x < minX) minX = s.x;
			if (s.y < minY) minY = s.y;
		}
		if (minX === Infinity) return null;
		return { x: minX, y: minY };
	}

	function captionText(ann) {
		var brand = (ann.brand || "").trim();
		var location = (ann.tpoint || "").trim();
		var hits = parseInt(ann.hits, 10) || 0;
		if (!brand && !location) return { text: "NULL", empty: true };
		return { text: (brand || "—") + "|" + (location || "—") + "|" + hits, empty: false };
	}

	function ensureCaptionLayer() {
		var box = document.getElementById("box");
		if (!box) return null;
		var layer = document.getElementById("annoCaptions");
		if (!layer || layer.parentNode !== box) {
			if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
			layer = document.createElement("div");
			layer.id = "annoCaptions";
			box.appendChild(layer);
			capNodes = {};
		}
		return layer;
	}

	function tickCaptions() {
		capRaf = 0;
		if (!captionsOn) return;
		var layer = ensureCaptionLayer();
		if (layer && brd && brd.objectsList) {
			var seen = {};
			eachBoardPolygon(function (o) {
				if (!o.annotation) return;
				var id = o.id;
				seen[id] = true;
				var pos = topLeft(o);
				var cap = captionText(o.annotation);
				var node = capNodes[id];
				if (!node) {
					node = document.createElement("div");
					node.className = "anno-cap";
					layer.appendChild(node);
					capNodes[id] = node;
				}
				if (node.textContent !== cap.text) node.textContent = cap.text;
				node.classList.toggle("is-null", cap.empty);
				if (pos) {
					node.style.left = Math.max(0, Math.round(pos.x) + 3) + "px";
					node.style.top = Math.max(0, Math.round(pos.y) + 3) + "px";
				}
			});
			for (var id in capNodes) {
				if (!capNodes.hasOwnProperty(id) || seen[id]) continue;
				if (capNodes[id].parentNode) capNodes[id].parentNode.removeChild(capNodes[id]);
				delete capNodes[id];
			}
		}
		capRaf = requestAnimationFrame(tickCaptions);
	}

	function setCaptions(on) {
		captionsOn = !!on;
		var btn = document.getElementById("btn_captions");
		if (btn) btn.classList.toggle("on", captionsOn);
		if (!captionsOn) {
			if (capRaf) cancelAnimationFrame(capRaf);
			capRaf = 0;
			var layer = document.getElementById("annoCaptions");
			if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
			capNodes = {};
			return;
		}
		if (!capRaf) capRaf = requestAnimationFrame(tickCaptions);
	}

	function toggleCaptions() {
		setCaptions(!captionsOn);
	}

	function bind() {
		$("#comboGlanceOpen, #btn_combos").on("click", function () {
			togglePanel();
			this.blur();
		});
		$("#comboPanelClose").on("click", function () {
			setPanel(false);
		});
		$("#btn_captions").on("click", function () {
			toggleCaptions();
			this.blur();
		});
		$("#comboMetric").on("click", "button", function () {
			setMetric(this.getAttribute("data-metric"));
		});
		$("#comboSearch").on("input", function () {
			query = this.value || "";
			refresh();
		});
		$("#comboPick").on("change", function () {
			manualWatch = true;
			watchedKey = this.value || "";
			refresh();
			if (typeof goToFilteredStart === "function") goToFilteredStart();
		});
		$("#comboList").on("click", ".combo-row", function (e) {
			if ($(e.target).closest("input, label, button").length) return;
			manualWatch = true;
			watchedKey = this._comboKey || "";
			refresh();
			if (typeof goToFilteredStart === "function") goToFilteredStart();
		});
		$("#comboList").on("click", ".combo-lock", function (e) {
			e.preventDefault();
			e.stopPropagation();
			var row = $(this).closest(".combo-row")[0];
			if (!row || !row._comboKey) return;
			toggleLock(row._comboKey);
			refresh();
		});
		$("#comboLockClear").on("click", function () {
			setLocks([]);
			refresh();
			this.blur();
		});
			var key = $(this).closest(".combo-row")[0]._comboKey;
			var raw = $.trim(this.value);
			setTarget(key, raw === "" ? "" : (parseInt(raw, 10) || 0));
			refresh();
		});
		$("#comboPanel").on("mousewheel DOMMouseScroll wheel", function (e) {
			e.stopPropagation();
		});
		$("#comboPanelHead").on("mousedown", function (e) {
			if ($(e.target).closest("button, input").length) return;
			var panel = document.getElementById("comboPanel");
			var rect = panel.getBoundingClientRect();
			drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
			e.preventDefault();
		});
		$(document).on("mousemove", function (e) {
			if (!drag) return;
			var panel = document.getElementById("comboPanel");
			var left = Math.max(8, e.clientX - drag.dx);
			var top = Math.max(8, e.clientY - drag.dy);
			panel.style.left = left + "px";
			panel.style.top = top + "px";
			panel.style.right = "auto";
		});
		$(document).on("mouseup", function () {
			if (!drag) return;
			drag = null;
			var panel = document.getElementById("comboPanel");
			var rect = panel.getBoundingClientRect();
			try {
				localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
			} catch (e) {}
		});
		if (window.Mousetrap) {
			Mousetrap.bind(";", function (e) {
				if (e.preventDefault) e.preventDefault();
				toggleCaptions();
			});
		}
		if (typeof storeAnnotationImg === "function" && !storeAnnotationImg._liveWrapped) {
			var orig = storeAnnotationImg;
			window.storeAnnotationImg = function () {
				var result = orig.apply(this, arguments);
				refresh();
				return result;
			};
			window.storeAnnotationImg._liveWrapped = true;
		}
	}

	function init() {
		var savedMetric = "";
		try { savedMetric = localStorage.getItem(METRIC_KEY) || ""; } catch (e) {}
		metric = savedMetric === "hits" ? "hits" : "boxes";
		var buttons = document.querySelectorAll("#comboMetric button");
		for (var i = 0; i < buttons.length; i++) {
			buttons[i].classList.toggle("on", buttons[i].getAttribute("data-metric") === metric);
		}
		bind();
		var open = false;
		try {
			var flag = localStorage.getItem(OPEN_KEY);
			if (flag === "1") open = true;
			else if (flag === "0") open = false;
			else open = window.innerWidth >= 1600;
		} catch (e2) {
			open = window.innerWidth >= 1600;
		}
		setPanel(open);
		refresh();
		setInterval(refresh, 400);
	}

	window.AnnoLive = {
		refresh: refresh,
		openPanel: function () { setPanel(true); },
		setCaptions: setCaptions,
		toggleCaptions: toggleCaptions,
		navCombo: function () {
			if (!manualWatch || !watchedKey) return null;
			var parts = watchedKey.split(SEP);
			var brand = (parts[0] || "").trim();
			var location = parts.slice(1).join(SEP).trim();
			if (!brand || !location) return null;
			return { brand: brand, location: location };
		},
		navCombos: function () {
			var list = lockedCombos();
			return list.length ? list : null;
		}
	};

	if (document.getElementById("comboPanel")) init();
	else $(init);
})();
