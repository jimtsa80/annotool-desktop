(function () {
	var GRID = 16;
	var EDGE = 32;
	var MIN_SIM = 0.82;
	var MIN_EDGE = 0.58;
	var MIN_SUPPORT = 3;
	var MAX_PER_COMBO = 8;
	var examples = [];
	var loadedProject = "";
	var loadWait = null;
	var pending = null;
	var cache = { name: "", img: null };
	var imageWait = [];
	var imageLoading = false;
	var dbp = null;

	function projectName() {
		if (typeof prefs !== "undefined" && prefs && prefs.projectName) return prefs.projectName;
		if (typeof allAnnotations !== "undefined" && allAnnotations && allAnnotations.project) return allAnnotations.project;
		return "_";
	}

	function db() {
		if (dbp) return dbp;
		dbp = new Promise(function (resolve, reject) {
			if (!window.indexedDB) return reject(new Error("no idb"));
			var req = indexedDB.open("annotool-suggest", 1);
			req.onupgradeneeded = function () {
				var base = req.result;
				if (!base.objectStoreNames.contains("examples")) {
					base.createObjectStore("examples", { keyPath: "id", autoIncrement: true });
				}
			};
			req.onsuccess = function () { resolve(req.result); };
			req.onerror = function () { reject(req.error); };
		});
		return dbp;
	}

	function finishLoad(cbs) {
		for (var i = 0; i < cbs.length; i++) cbs[i]();
	}

	function loadExamples(name, done) {
		if (name === loadedProject) return done();
		if (loadWait && loadWait.name === name) {
			loadWait.done.push(done);
			return;
		}
		loadWait = { name: name, done: [done] };
		db().then(function (base) {
			var req = base.transaction("examples", "readonly").objectStore("examples").getAll();
			req.onsuccess = function () {
				var rows = req.result || [];
				var next = [];
				for (var i = 0; i < rows.length; i++) {
					if (rows[i].project === name) next.push(rows[i]);
				}
				examples = next;
				loadedProject = name;
				var cbs = loadWait ? loadWait.done : [];
				loadWait = null;
				finishLoad(cbs);
			};
			req.onerror = function () {
				var cbs = loadWait ? loadWait.done : [];
				loadWait = null;
				finishLoad(cbs);
			};
		}).catch(function () {
			var cbs = loadWait ? loadWait.done : [];
			loadWait = null;
			finishLoad(cbs);
		});
	}

	function withImage(cb) {
		if (typeof imName === "undefined" || typeof imAll === "undefined" || !imAll[imName]) return;
		if (cache.name === imName && cache.img && cache.img.complete && cache.img.naturalWidth) {
			cb(cache.img);
			return;
		}
		imageWait.push(cb);
		if (imageLoading) return;
		imageLoading = true;
		var image = new Image();
		var name = imName;
		image.onload = function () {
			cache = { name: name, img: image };
			imageLoading = false;
			var wait = imageWait.splice(0, imageWait.length);
			for (var i = 0; i < wait.length; i++) wait[i](image);
		};
		image.onerror = function () {
			imageLoading = false;
			imageWait = [];
		};
		image.src = (typeof im !== "undefined" && im && im.url) ? im.url : URL.createObjectURL(imAll[name]);
	}

	function polyRect(poly) {
		if (!poly || !poly.getParents || typeof JXG === "undefined" || typeof brd === "undefined") return null;
		var parents = poly.getParents();
		var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
		for (var i = 0; i < parents.length; i++) {
			var p = brd.objects[parents[i]];
			if (!p || typeof p.X !== "function") continue;
			var c = new JXG.Coords(JXG.COORDS_BY_USER, [p.X(), p.Y()], brd);
			var x = c.scrCoords[1], y = c.scrCoords[2];
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
			n++;
		}
		if (n < 2) return null;
		return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
	}

	function embed(poly, image, cb) {
		var rect = polyRect(poly);
		var box = document.getElementById("box");
		if (!rect || !box || rect.w < 8 || rect.h < 8) return;
		var bw = box.clientWidth || 1, bh = box.clientHeight || 1;
		var sx0 = rect.x / bw * image.naturalWidth;
		var sy0 = rect.y / bh * image.naturalHeight;
		var sw = rect.w / bw * image.naturalWidth;
		var sh = rect.h / bh * image.naturalHeight;
		if (sx0 < 0) { sw += sx0; sx0 = 0; }
		if (sy0 < 0) { sh += sy0; sy0 = 0; }
		if (sx0 + sw > image.naturalWidth) sw = image.naturalWidth - sx0;
		if (sy0 + sh > image.naturalHeight) sh = image.naturalHeight - sy0;
		if (sw < 4 || sh < 4) return;
		var canvas = document.createElement("canvas");
		canvas.width = GRID;
		canvas.height = GRID;
		var ctx = canvas.getContext("2d");
		ctx.drawImage(image, sx0, sy0, sw, sh, 0, 0, GRID, GRID);
		var data = ctx.getImageData(0, 0, GRID, GRID).data;
		var vec = [];
		var norm = 0;
		for (var i = 0; i < data.length; i += 4) {
			var r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
			vec.push(r, g, b);
			norm += r * r + g * g + b * b;
		}
		norm = Math.sqrt(norm) || 1;
		for (var k = 0; k < vec.length; k++) vec[k] /= norm;
		var shapeCanvas = document.createElement("canvas");
		shapeCanvas.width = EDGE;
		shapeCanvas.height = EDGE;
		var shapeCtx = shapeCanvas.getContext("2d");
		shapeCtx.drawImage(image, sx0, sy0, sw, sh, 0, 0, EDGE, EDGE);
		var shapeData = shapeCtx.getImageData(0, 0, EDGE, EDGE).data;
		cb(vec, edgeMap(shapeData, EDGE, EDGE), {
			x: (rect.x + rect.w / 2) / bw,
			y: (rect.y + rect.h / 2) / bh
		});
	}

	function edgeMap(data, w, h) {
		var lum = [], i, x, y;
		for (i = 0; i < data.length; i += 4) {
			lum.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
		}
		var edge = [];
		for (y = 0; y < h; y++) {
			for (x = 0; x < w; x++) {
				var xm = x > 0 ? x - 1 : x;
				var xp = x < w - 1 ? x + 1 : x;
				var ym = y > 0 ? y - 1 : y;
				var yp = y < h - 1 ? y + 1 : y;
				var gx = lum[y * w + xp] - lum[y * w + xm];
				var gy = lum[yp * w + x] - lum[ym * w + x];
				edge.push(Math.sqrt(gx * gx + gy * gy) / 255);
			}
		}
		var norm = 0;
		for (i = 0; i < edge.length; i++) norm += edge[i] * edge[i];
		norm = Math.sqrt(norm) || 1;
		for (i = 0; i < edge.length; i++) edge[i] /= norm;
		return edge;
	}

	function cosine(a, b) {
		if (!a || !b || a.length !== b.length) return 0;
		var s = 0;
		for (var i = 0; i < a.length; i++) s += a[i] * b[i];
		return s;
	}

	function resolve(brand, tpoint) {
		if (typeof prefs === "undefined" || !prefs || !prefs.conns) return null;
		var key, conn, list, i;
		for (key in prefs.conns) {
			if (!prefs.conns.hasOwnProperty(key)) continue;
			conn = prefs.conns[key];
			if (!conn || conn.brand !== brand) continue;
			list = conn.tpoints || [];
			for (i = 0; i < list.length; i++) {
				if (list[i] === tpoint) return { group: conn.group, brand: brand, tpoint: tpoint };
			}
		}
		return null;
	}

	function chip() {
		var el = document.getElementById("suggestChip");
		if (el) return el;
		var box = document.getElementById("box");
		if (!box) return null;
		el = document.createElement("div");
		el.id = "suggestChip";
		box.appendChild(el);
		return el;
	}

	function clearPending() {
		pending = null;
		var el = document.getElementById("suggestChip");
		if (el) {
			el.className = "";
			el.textContent = "";
		}
	}

	function showChip() {
		var el = chip();
		if (!el || !pending) return;
		el.textContent = pending.brand + " · " + pending.tpoint + " · " + Math.round(pending.sim * 100) + "% · " + pending.hits + " hits · Enter";
		el.className = "on";
		placeChip();
	}

	function placeChip() {
		var el = chip();
		var board = document.getElementById("box");
		if (!el || !board || !pending || !pending.poly) return;
		var rect = polyRect(pending.poly);
		if (!rect) return;
		var width = el.offsetWidth || 220;
		var height = el.offsetHeight || 28;
		var left = rect.x + rect.w + 8;
		if (left + width > board.clientWidth - 4) left = rect.x - width - 8;
		if (left < 4) left = 4;
		var top = rect.y;
		if (top + height > board.clientHeight - 4) top = board.clientHeight - height - 4;
		if (top < 4) top = 4;
		el.style.bottom = "auto";
		el.style.left = left + "px";
		el.style.top = top + "px";
		placeQuick();
	}

	function usualHits(brand, tpoint) {
		var counts = {};
		function add(ann) {
			if (!ann) return;
			if ((ann.brand || "").trim() !== brand || (ann.tpoint || "").trim() !== tpoint) return;
			var h = parseInt(ann.hits, 10);
			if (!(h >= 1)) return;
			counts[h] = (counts[h] || 0) + 1;
		}
		var images = (typeof allAnnotations !== "undefined" && allAnnotations && allAnnotations.images) || {};
		var name, list, i, obj;
		for (name in images) {
			if (!images.hasOwnProperty(name) || name === imName) continue;
			list = images[name].annotations || [];
			for (i = 0; i < list.length; i++) add(list[i]);
		}
		if (typeof brd !== "undefined" && brd && brd.objectsList) {
			for (i = 0; i < brd.objectsList.length; i++) {
				obj = brd.objectsList[i];
				if (obj && obj.getType && obj.getType() === "polygon") add(obj.annotation);
			}
		}
		var best = 0, bestN = 0, tie = false, key;
		for (key in counts) {
			if (!counts.hasOwnProperty(key)) continue;
			if (counts[key] > bestN) {
				bestN = counts[key];
				best = parseInt(key, 10);
				tie = false;
			} else if (counts[key] === bestN) tie = true;
		}
		if (!bestN || tie) return 1;
		return best;
	}

	function rank(vec, edge, pos) {
		var scored = [], i, color, shape, ex;
		for (i = 0; i < examples.length; i++) {
			ex = examples[i];
			if (!ex.edge) continue;
			color = cosine(vec, ex.vec);
			shape = cosine(edge, ex.edge);
			scored.push({
				ex: ex,
				sim: Math.min(color, shape),
				color: color,
				shape: shape,
				dist: Math.abs(pos.x - ex.posx) + Math.abs(pos.y - ex.posy)
			});
		}
		if (!scored.length) return null;
		scored.sort(function (a, b) { return b.sim - a.sim; });
		var pool = [];
		for (i = 0; i < scored.length; i++) {
			if (scored[i].sim >= scored[0].sim - 0.04) pool.push(scored[i]);
		}
		pool.sort(function (a, b) {
			if (Math.abs(a.sim - b.sim) > 0.02) return b.sim - a.sim;
			return a.dist - b.dist;
		});
		var pick = pool[0];
		if (!pick || pick.color < MIN_SIM || pick.shape < MIN_EDGE) return null;
		var pkey = pick.ex.brand + "\0" + pick.ex.tpoint;
		var support = 0, agree = 0;
		for (i = 0; i < scored.length; i++) {
			var key = scored[i].ex.brand + "\0" + scored[i].ex.tpoint;
			if (key !== pkey) continue;
			support++;
			if (scored[i].color >= MIN_SIM && scored[i].shape >= MIN_EDGE) agree++;
		}
		if (support < MIN_SUPPORT || agree < 2) return null;
		for (i = 0; i < scored.length; i++) {
			key = scored[i].ex.brand + "\0" + scored[i].ex.tpoint;
			if (key === pkey) continue;
			if (pick.sim - scored[i].sim < 0.03) return null;
			break;
		}
		return pick;
	}

	function remember(row) {
		var same = [], i;
		for (i = 0; i < examples.length; i++) {
			if (examples[i].edge && examples[i].brand === row.brand && examples[i].tpoint === row.tpoint) same.push(examples[i]);
		}
		if (same.length >= MIN_SUPPORT) {
			for (i = 0; i < same.length; i++) {
				if (cosine(same[i].vec, row.vec) > 0.97 && cosine(same[i].edge, row.edge) > 0.97) return;
			}
		}
		examples.push(row);
		if (same.length + 1 > MAX_PER_COMBO) {
			var oldest = same[0];
			for (i = 1; i < same.length; i++) {
				if ((same[i].id || 0) < (oldest.id || 0)) oldest = same[i];
			}
			examples.splice(examples.indexOf(oldest), 1);
			if (oldest.id) {
				db().then(function (base) {
					base.transaction("examples", "readwrite").objectStore("examples").delete(oldest.id);
				}).catch(function () {});
			}
		}
		db().then(function (base) {
			var tx = base.transaction("examples", "readwrite");
			var req = tx.objectStore("examples").add(row);
			req.onsuccess = function () { row.id = req.result; };
		}).catch(function () {});
	}

	function learnPoly(poly, image) {
		var ann = poly.annotation || {};
		var brand = (ann.brand || "").trim();
		var tpoint = (ann.tpoint || "").trim();
		if (!brand || !tpoint) return;
		if (!resolve(brand, tpoint)) return;
		var sig = "e1\0" + brand + "\0" + tpoint;
		if (poly._suggestSig === sig) return;
		embed(poly, image, function (vec, edge, pos) {
			if (poly._suggestSig === sig) return;
			poly._suggestSig = sig;
			remember({
				project: projectName(),
				brand: brand,
				tpoint: tpoint,
				vec: vec,
				edge: edge,
				posx: pos.x,
				posy: pos.y
			});
		});
	}

	function learnVisible() {
		if (typeof brd === "undefined" || !brd || !brd.objectsList) return;
		loadExamples(projectName(), function () {
			withImage(function (image) {
				var list = brd.objectsList, i, obj;
				for (i = 0; i < list.length; i++) {
					obj = list[i];
					if (!obj || !obj.getType || obj.getType() !== "polygon") continue;
					if (obj.getAttribute && obj.getAttribute("visible") === false) continue;
					learnPoly(obj, image);
				}
			});
		});
	}

	var quick = null;
	var typed = "";
	var typeTimer = 0;

	function quickEl() {
		var el = document.getElementById("quickPick");
		if (el) return el;
		var box = document.getElementById("box");
		if (!box) return null;
		el = document.createElement("div");
		el.id = "quickPick";
		el.addEventListener("mousedown", function (e) { e.stopPropagation(); e.preventDefault(); });
		el.addEventListener("click", onQuickClick);
		box.appendChild(el);
		return el;
	}

	function closeQuick() {
		quick = null;
		typed = "";
		var el = document.getElementById("quickPick");
		if (el) {
			el.className = "";
			el.innerHTML = "";
		}
	}

	function freqBrands() {
		var counts = (typeof listCounts === "function") ? listCounts().brands : {};
		var rows = [], seen = {};
		$("#brands ul li.brand").each(function () {
			var id = this.id || "";
			var cut = id.indexOf("__");
			var group = cut < 0 ? "" : id.slice(0, cut);
			var brand = $.trim($(this).text());
			var key = group + "\0" + brand;
			if (!brand || seen[key]) return;
			seen[key] = 1;
			rows.push({ group: group, brand: brand, n: counts[id] || 0 });
		});
		rows.sort(function (a, b) { return (b.n - a.n) || a.brand.localeCompare(b.brand); });
		return rows;
	}

	function freqLocs(group, brand) {
		var counts = (typeof listCounts === "function") ? listCounts().locs : {};
		var conn = (typeof prefs !== "undefined" && prefs && prefs.conns) ? prefs.conns[group + "__" + brand] : null;
		var list = (conn && conn.tpoints) || [];
		var rows = [], seen = {}, i, name;
		for (i = 0; i < list.length; i++) {
			name = $.trim(list[i] || "");
			if (!name || seen[name]) continue;
			seen[name] = 1;
			rows.push({ tpoint: name, n: counts[brand + "\0" + name] || 0 });
		}
		rows.sort(function (a, b) { return (b.n - a.n) || a.tpoint.localeCompare(b.tpoint); });
		return rows;
	}

	function matches(name) {
		if (!typed) return true;
		return name.toLowerCase().indexOf(typed.toLowerCase()) === 0;
	}

	function shownBrands() {
		var rows = freqBrands().filter(function (r) { return matches(r.brand); });
		var used = rows.filter(function (r) { return r.n > 0; });
		return (typed ? rows : (used.length ? used : rows)).slice(0, 8);
	}

	function shownLocs() {
		var rows = freqLocs(quick.group, quick.brand).filter(function (r) { return matches(r.tpoint); });
		var used = rows.filter(function (r) { return r.n > 0; });
		return (typed ? rows : (used.length ? used : rows)).slice(0, 8);
	}

	function qpButton(label, attrs, cls) {
		var b = document.createElement("button");
		b.type = "button";
		b.className = cls || "qp-item";
		b.textContent = label;
		var k;
		for (k in attrs) if (attrs.hasOwnProperty(k)) b.setAttribute(k, attrs[k]);
		return b;
	}

	function renderQuick() {
		var el = quickEl();
		if (!el || !quick) return;
		while (el.firstChild) el.removeChild(el.firstChild);
		el.className = "on";
		if (typed) {
			var hint = document.createElement("div");
			hint.className = "qp-hint";
			hint.textContent = typed;
			el.appendChild(hint);
		}
		if (quick.step === "brand") {
			var brands = shownBrands(), i;
			if (!brands.length) {
				var empty = document.createElement("div");
				empty.className = "qp-hint";
				empty.textContent = "κανένα brand";
				el.appendChild(empty);
			}
			for (i = 0; i < brands.length; i++) {
				el.appendChild(qpButton(brands[i].brand, { "data-act": "brand", "data-group": brands[i].group, "data-brand": brands[i].brand }));
			}
		} else {
			el.appendChild(qpButton(quick.brand, { "data-act": "back" }, "qp-back"));
			var locs = shownLocs();
			for (i = 0; i < locs.length; i++) {
				var on = locs[i].tpoint === quick.tpoint;
				el.appendChild(qpButton(locs[i].tpoint, { "data-act": "loc", "data-loc": locs[i].tpoint }, on ? "qp-item on" : "qp-item"));
			}
			if (quick.tpoint) {
				var row = document.createElement("div");
				row.className = "qp-hits";
				row.appendChild(qpButton("−", { "data-act": "hit", "data-dir": "-1" }, "qp-mini"));
				var num = document.createElement("span");
				num.textContent = quick.hits + " hits";
				row.appendChild(num);
				row.appendChild(qpButton("+", { "data-act": "hit", "data-dir": "1" }, "qp-mini"));
				row.appendChild(qpButton("Enter", { "data-act": "ok" }, "qp-ok"));
				el.appendChild(row);
			}
		}
		placeQuick();
	}

	function placeQuick() {
		var el = document.getElementById("quickPick");
		var board = document.getElementById("box");
		var chipEl = document.getElementById("suggestChip");
		if (!el || !board || !quick || !quick.poly) return;
		var rect = polyRect(quick.poly);
		if (!rect) return;
		var width = el.offsetWidth || 180;
		var height = el.offsetHeight || 40;
		var left = rect.x + rect.w + 8;
		if (left + width > board.clientWidth - 4) left = rect.x - width - 8;
		if (left < 4) left = 4;
		var top = rect.y;
		if (chipEl && chipEl.className.indexOf("on") !== -1) {
			left = chipEl.offsetLeft;
			top = chipEl.offsetTop + chipEl.offsetHeight + 4;
		}
		if (top + height > board.clientHeight - 4) top = Math.max(4, board.clientHeight - height - 4);
		el.style.left = left + "px";
		el.style.top = top + "px";
	}

	function openQuick(poly) {
		quick = { poly: poly, step: "brand", group: "", brand: "", tpoint: "", hits: 1 };
		typed = "";
		renderQuick();
	}

	function chooseBrand(group, brand) {
		if (!quick) return;
		quick.step = "loc";
		quick.group = group;
		quick.brand = brand;
		quick.tpoint = "";
		quick.hits = 1;
		typed = "";
		renderQuick();
	}

	function commitQuick() {
		if (!quick || !quick.poly || !quick.poly.annotation || !quick.brand || !quick.tpoint) return;
		var poly = quick.poly;
		var wasEmpty = !poly.annotation.brand || !poly.annotation.tpoint;
		poly.annotation.group = quick.group;
		poly.annotation.brand = quick.brand;
		poly.annotation.tpoint = quick.tpoint;
		poly.annotation.hits = quick.hits || 1;
		var hitsBox = document.getElementById("hits");
		if (hitsBox) hitsBox.value = String(poly.annotation.hits);
		if (!poly.annotation.timestamp) poly.annotation.timestamp = new Date().toISOString();
		if (wasEmpty && typeof nullAnnoFlag !== "undefined") nullAnnoFlag--;
		selectCombo(quick.group, quick.brand, quick.tpoint);
		closeQuick();
		clearPending();
		if (typeof brd !== "undefined" && brd) brd.update();
		learnVisible();
		if (typeof applyBrandOrder === "function") applyBrandOrder();
		if (typeof applyTpointOrder === "function") applyTpointOrder();
		if (window.AnnoLive && AnnoLive.refresh) AnnoLive.refresh();
	}

	function onQuickClick(e) {
		var btn = e.target && e.target.getAttribute ? e.target : null;
		if (!btn || !btn.getAttribute("data-act") || !quick) return;
		e.stopPropagation();
		var act = btn.getAttribute("data-act");
		if (act === "brand") chooseBrand(btn.getAttribute("data-group") || "", btn.getAttribute("data-brand") || "");
		else if (act === "back") {
			quick.step = "brand";
			quick.tpoint = "";
			typed = "";
			renderQuick();
		} else if (act === "loc") {
			quick.tpoint = btn.getAttribute("data-loc") || "";
			quick.hits = usualHits(quick.brand, quick.tpoint);
			typed = "";
			renderQuick();
		} else if (act === "hit") {
			var next = (quick.hits || 1) + (parseInt(btn.getAttribute("data-dir"), 10) || 0);
			if (next < 1) next = 1;
			if (next > 15) next = 15;
			quick.hits = next;
			renderQuick();
		} else if (act === "ok") commitQuick();
	}

	function offer(poly) {
		if (!poly || !poly.annotation || poly.annotation.brand || poly.annotation.tpoint) return;
		openQuick(poly);
		loadExamples(projectName(), function () {
			learnVisible();
			withImage(function (image) {
				if (!poly.annotation || poly.annotation.brand) return;
				embed(poly, image, function (vec, edge, pos) {
					if (!poly.annotation || poly.annotation.brand) return;
					var pick = rank(vec, edge, pos);
					if (!pick) {
						if (pending && pending.poly === poly) clearPending();
						placeQuick();
						return;
					}
					var known = resolve(pick.ex.brand, pick.ex.tpoint);
					if (!known) return;
					pending = {
						poly: poly,
						group: known.group,
						brand: known.brand,
						tpoint: known.tpoint,
						sim: pick.sim,
						hits: usualHits(known.brand, known.tpoint)
					};
					showChip();
				});
			});
		});
	}

	function selectCombo(group, brand, tpoint) {
		var id = group + "__" + brand;
		$("#brands ul li").removeClass("selected");
		var li = $("#brands ul li").filter(function () { return this.id === id; }).first();
		if (!li.length) return;
		li.addClass("selected");
		if (typeof fillTouchpoints === "function") fillTouchpoints(id);
		if (typeof tpointsInit === "function") tpointsInit();
		$("#tpoints ul li").removeClass("selected");
		$("#tpoints ul li").filter(function () { return $(this).text() === tpoint; }).first().addClass("selected");
	}

	function accept() {
		if (!pending || !pending.poly || !pending.poly.annotation) return;
		var poly = pending.poly;
		var wasEmpty = !poly.annotation.brand || !poly.annotation.tpoint;
		poly.annotation.group = pending.group;
		poly.annotation.brand = pending.brand;
		poly.annotation.tpoint = pending.tpoint;
		poly.annotation.hits = pending.hits || 1;
		var hitsBox = document.getElementById("hits");
		if (hitsBox) hitsBox.value = String(poly.annotation.hits);
		if (!poly.annotation.timestamp) poly.annotation.timestamp = new Date().toISOString();
		if (wasEmpty && typeof nullAnnoFlag !== "undefined") nullAnnoFlag--;
		selectCombo(pending.group, pending.brand, pending.tpoint);
		clearPending();
		if (typeof brd !== "undefined" && brd) brd.update();
		learnVisible();
		if (window.AnnoLive && AnnoLive.refresh) AnnoLive.refresh();
	}

	function boot() {
		if (typeof prepareChangeImg === "function" && !prepareChangeImg._suggestWrapped) {
			var prep = prepareChangeImg;
			window.prepareChangeImg = function () {
				clearPending();
				closeQuick();
				return prep.apply(this, arguments);
			};
			window.prepareChangeImg._suggestWrapped = true;
		}
		if (typeof storeAnnotationImg === "function" && !storeAnnotationImg._suggestWrapped) {
			var store = storeAnnotationImg;
			window.storeAnnotationImg = function () {
				var result = store.apply(this, arguments);
				learnVisible();
				if (typeof applyBrandOrder === "function") applyBrandOrder();
				if (typeof applyTpointOrder === "function") applyTpointOrder();
				return result;
			};
			window.storeAnnotationImg._suggestWrapped = true;
		}
		$("#hits").on("change", function () {
			clearPending();
			closeQuick();
			learnVisible();
		});
		var box = document.getElementById("box");
		if (box) {
			box.addEventListener("click", function (e) {
				if (!pending) return;
				if (e.target && e.target.id === "suggestChip") accept();
			});
		}
		document.addEventListener("keydown", function (e) {
			if (!pending && !quick) return;
			var key = e.key || "";
			var code = e.keyCode || e.which;
			var enter = key === "Enter" || code === 13;
			var esc = key === "Escape" || key === "Esc" || code === 27;
			var el = e.target;
			var id = el && el.id;
			if (el && (id === "newbrand" || id === "newtpoint" || (el.classList && el.classList.contains("editable")))) return;
			if (esc) {
				e.preventDefault();
				e.stopPropagation();
				clearPending();
				closeQuick();
				return;
			}
			if (enter) {
				e.preventDefault();
				e.stopPropagation();
				if (quick && quick.tpoint) commitQuick();
				else if (quick && quick.step === "brand") {
					var one = shownBrands();
					if (one.length === 1) chooseBrand(one[0].group, one[0].brand);
				} else if (pending) accept();
				return;
			}
			if (!quick || key.length !== 1 || !/^[a-z0-9]$/i.test(key)) return;
			e.preventDefault();
			e.stopPropagation();
			typed += key;
			clearTimeout(typeTimer);
			typeTimer = setTimeout(function () {
				typed = "";
				if (quick) renderQuick();
			}, 800);
			renderQuick();
		}, true);
		setInterval(learnVisible, 2000);
	}

	window.AnnoSuggest = {
		offer: offer,
		accept: accept,
		clear: clearPending
	};

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
	else boot();
})();
