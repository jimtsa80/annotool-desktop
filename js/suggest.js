(function () {
	var GRID = 16;
	var MIN_SIM = 0.82;
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
		cb(vec, {
			x: (rect.x + rect.w / 2) / bw,
			y: (rect.y + rect.h / 2) / bh
		});
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
		el.textContent = pending.brand + " · " + pending.tpoint + " · " + Math.round(pending.sim * 100) + "% · Enter";
		el.className = "on";
	}

	function rank(vec, pos) {
		var scored = [], i, sim, ex;
		for (i = 0; i < examples.length; i++) {
			ex = examples[i];
			sim = cosine(vec, ex.vec);
			scored.push({
				ex: ex,
				sim: sim,
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
		if (!pick || pick.sim < MIN_SIM) return null;
		var pkey = pick.ex.brand + "\0" + pick.ex.tpoint;
		var support = 0, agree = 0;
		for (i = 0; i < scored.length; i++) {
			var key = scored[i].ex.brand + "\0" + scored[i].ex.tpoint;
			if (key !== pkey) continue;
			support++;
			if (scored[i].sim >= MIN_SIM) agree++;
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
			if (examples[i].brand === row.brand && examples[i].tpoint === row.tpoint) same.push(examples[i]);
		}
		if (same.length >= MIN_SUPPORT) {
			for (i = 0; i < same.length; i++) {
				if (cosine(same[i].vec, row.vec) > 0.97) return;
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
		var sig = brand + "\0" + tpoint;
		if (poly._suggestSig === sig) return;
		embed(poly, image, function (vec, pos) {
			if (poly._suggestSig === sig) return;
			poly._suggestSig = sig;
			remember({
				project: projectName(),
				brand: brand,
				tpoint: tpoint,
				vec: vec,
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

	function offer(poly) {
		if (!poly || !poly.annotation || poly.annotation.brand || poly.annotation.tpoint) return;
		loadExamples(projectName(), function () {
			learnVisible();
			withImage(function (image) {
				if (!poly.annotation || poly.annotation.brand) return;
				embed(poly, image, function (vec, pos) {
					if (!poly.annotation || poly.annotation.brand) return;
					var pick = rank(vec, pos);
					if (!pick) {
						if (pending && pending.poly === poly) clearPending();
						return;
					}
					var known = resolve(pick.ex.brand, pick.ex.tpoint);
					if (!known) return;
					pending = {
						poly: poly,
						group: known.group,
						brand: known.brand,
						tpoint: known.tpoint,
						sim: pick.sim
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
				return prep.apply(this, arguments);
			};
			window.prepareChangeImg._suggestWrapped = true;
		}
		if (typeof storeAnnotationImg === "function" && !storeAnnotationImg._suggestWrapped) {
			var store = storeAnnotationImg;
			window.storeAnnotationImg = function () {
				var result = store.apply(this, arguments);
				learnVisible();
				return result;
			};
			window.storeAnnotationImg._suggestWrapped = true;
		}
		$("#hits").on("change", function () {
			clearPending();
			learnVisible();
		});
		if (window.Mousetrap) {
			Mousetrap.bind("enter", function (e) {
				if (!pending) return;
				if (e.preventDefault) e.preventDefault();
				accept();
			});
			Mousetrap.bind("esc", function () {
				if (!pending) return;
				clearPending();
			});
		}
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
