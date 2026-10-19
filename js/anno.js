(function () {
	var topics = [
		{
			id: "memories",
			q: "Πού βλέπω τις μνήμες;",
			phrases: ["μνημες", "μνημη", "presets", "ματι", "λιστα μνημων", "που ειναι"],
			a: "Το κουμπί με το μάτι, πάνω από την εικόνα, ανοίγει τη λίστα. Δείχνει το πλήκτρο και το brand, location και hits. Οι άδειες γράφουν empty."
		},
		{
			id: "save",
			q: "Πώς σώζω και φέρνω μια μνήμη;",
			phrases: ["αποθηκευση", "σωσε", "shift", "επικολληση", "paste", "φερνω μνημη", "καλω"],
			a: "Αποθήκευση με Shift και το πλήκτρο, για παράδειγμα Shift+1. Τη φέρνεις με το ίδιο πλήκτρο σκέτο. Ισχύει και για F1 ως F12. Με Alt είναι δεύτερη σειρά: Shift+Alt+P για αποθήκευση, Alt+P για να έρθει. Το C αντιγράφει τα πράσινα κουτιά και το D τα ξαναβάζει."
		},
		{
			id: "grab",
			q: "Πώς αλλάζω θέση και μέγεθος;",
			phrases: ["θεση", "μεγεθος", "συρε", "ροδελα", "κουνα", "προσαρμοσε", "κλικ"],
			a: "Μόλις έρθει μια μνήμη, ή τα κουτιά της Μεταφοράς, είναι πιασμένα. Σύρε για τη θέση, ροδέλα για το μέγεθος, κλικ για να μείνουν."
		},
		{
			id: "carry",
			q: "Τι κάνει η Μεταφορά;",
			phrases: ["μεταφορα", "επομενη εικονα", "απο frame", "καρε", "τικ", "κουτια επομενη"],
			a: "Το τικ Μεταφορά είναι στη σκούρα μπάρα, δίπλα στο όνομα. Αναμμένο, το S ή το Next φέρνει τα κουτιά στην επόμενη εικόνα, αν αυτή είναι άδεια. Τα πιάνεις και τα προσαρμόζεις. Σβηστό, η επόμενη ανοίγει άδεια."
		},
		{
			id: "keys",
			q: "Ποια είναι τα βασικά πλήκτρα;",
			phrases: ["πληκτρα", "πληκτρολογιο", "συντομευσεις", "σβησε", "πισω", "μπροστα", "επομενη", "προηγουμενη"],
			a: "A προηγούμενη, S επόμενη. Shift+A και Shift+S πηδάνε 10. Z σβήνει τα επιλεγμένα, X τα σβήνει όλα. C αντιγραφή των πράσινων, D επικόλληση. V τα κάνει όλα πράσινα, F τα ξεμαρκάρει. Με Ctrl πατημένο επιλέγεις μερικά κουτιά."
		},
		{
			id: "suggest",
			q: "Το προτεινόμενο έχει λάθος hits",
			phrases: ["προτεινομενο", "προταση", "hits", "enter", "λαθος"],
			a: "Άλλαξε τα hits από τη λίστα ή με τη ροδέλα και μετά πάτα Enter. Η πρόταση μένει ανοιχτή μέχρι να το πατήσεις."
		},
		{
			id: "search",
			q: "Πώς ψάχνω brand;",
			phrases: ["αναζητηση", "search", "jab", "μικρα", "κεφαλαια", "φιλτρο λιστας"],
			a: "Στο κουτί brand search, και στα locations, δεν πειράζει αν γράψεις μικρά. Το ja βρίσκει και το JAB. Με το ποντίκι πάνω στη λίστα των brands, ένα γράμμα σε πάει στο brand που αρχίζει από αυτό."
		},
		{
			id: "replace",
			q: "Πώς αλλάζω ένα location;",
			phrases: ["αλλαγη", "λαθος location", "διορθωση", "κοκκινο", "πρασινο", "ναι"],
			a: "Στη στήλη των locations, κουμπί Αλλαγή. Διάλεξε το λάθος, κοκκινίζει. Μετά το σωστό, πρασινίζει. Γράψε ναι για να αλλάξει σε όλες τις εικόνες που είναι φορτωμένες."
		},
		{
			id: "sticky",
			q: "Τι κάνει το Μένει;",
			phrases: ["μενει", "πρασινη γραμμη", "να μην περναει", "σταθερα"],
			a: "Δίπλα στο Αλλαγή. Όλα τα locations περνάνε με τη Μεταφορά. Αν κάποιο δεν πρέπει, διάλεξέ το και πάτα Μένει. Η πράσινη γραμμή σημαίνει ότι περνάει. Δεύτερο πάτημα το σταματά."
		},
		{
			id: "clusters",
			q: "Πώς αλλάζω cluster;",
			phrases: ["cluster", "φακελος", "dropdown", "υποφακελος", "clusters"],
			a: "Όταν ο φάκελος έχει υποφακέλους, δίπλα στο όνομα της εικόνας υπάρχει λίστα. Διαλέγεις cluster και το File από πάνω αλλάζει. Το json που κατεβάζεις είναι αυτού που είναι επιλεγμένο."
		},
		{
			id: "start",
			q: "Πώς ξεκινάω project;",
			phrases: ["txt", "εικονες", "new project", "αρχη", "φορτωσε", "preferences"],
			a: "New Project καθαρίζει τη δουλειά. Μετά φορτώνεις το txt από το γρανάζι και τις εικόνες από τον φάκελο. Το txt διαβάζεται μία φορά. Αλλαγές σε brands και locations δεν γράφονται μόνες τους πίσω. Το κουμπί save to txt, πάνω από τα hits, τις σώζει σε νέο txt."
		},
		{
			id: "export",
			q: "Πώς κατεβάζω το json;",
			phrases: ["export", "json", "csv", "κατεβασμα", "εξαγωγη"],
			a: "Από το πάνω μενού, το json κατεβάζει το επιλεγμένο cluster και το csv του. Το video.csv κατεβάζει μόνο το csv."
		},
		{
			id: "arrow",
			q: "Τι κάνει το βελάκι;",
			phrases: ["βελακι", "πανω μενου", "κρυψε", "top panel"],
			a: "Το βελάκι πάνω από την εικόνα κρύβει και ξαναδείχνει το πάνω μενού. Η εικόνα μένει μέσα στην οθόνη."
		}
	];

	var lastId = "";

	function fold(s) {
		return String(s || "").toLowerCase()
			.replace(/ά/g, "α").replace(/έ/g, "ε").replace(/ή/g, "η").replace(/ί|ϊ|ΐ/g, "ι")
			.replace(/ό/g, "ο").replace(/ύ|ϋ|ΰ/g, "υ").replace(/ώ/g, "ω").replace(/ς/g, "σ");
	}

	function tokens(s) {
		var parts = fold(s).split(/[^a-zα-ω0-9]+/);
		var stop = { και: 1, που: 1, πως: 1, για: 1, απο: 1, στο: 1, στη: 1, στον: 1, στην: 1, το: 1, τα: 1, τη: 1, την: 1, του: 1, των: 1, με: 1, να: 1, ειναι: 1, μια: 1, μου: 1, σου: 1, τι: 1, αν: 1, θα: 1, δεν: 1, μη: 1, κανω: 1, κανεις: 1 };
		var out = [], i;
		for (i = 0; i < parts.length; i++) {
			if (parts[i].length < 2 || stop[parts[i]]) continue;
			out.push(parts[i]);
		}
		return out;
	}

	function scoreTopic(topic, words, raw) {
		var bag = fold(topic.q + " " + topic.phrases.join(" ") + " " + topic.a);
		var n = 0, i;
		for (i = 0; i < words.length; i++) if (bag.indexOf(words[i]) !== -1) n++;
		if (raw && bag.indexOf(raw) !== -1 && raw.length > 3) n += 3;
		return n;
	}

	function replyTo(text) {
		var raw = fold(text).replace(/\s+/g, " ").trim();
		var words = tokens(text);
		var follow = /^(και )?μετα|πιο αναλυτικα|το ιδιο|συνεχισε|κι αλλο/.test(raw);
		if (follow && lastId) {
			var prev = topicById(lastId);
			if (prev) return prev.a;
		}
		var best = null, bestN = 0, second = 0, i, n;
		for (i = 0; i < topics.length; i++) {
			n = scoreTopic(topics[i], words, raw);
			if (n > bestN) { second = bestN; bestN = n; best = topics[i]; }
			else if (n > second) second = n;
		}
		if (!best || bestN < 2) return "Αυτό δεν το ξέρω. Διάλεξε μια ερώτηση από τη λίστα.";
		if (second === bestN) return "Μπορεί να είναι δύο πράγματα. Διάλεξε την ερώτηση από τη λίστα.";
		lastId = best.id;
		return best.a;
	}

	function topicById(id) {
		var i;
		for (i = 0; i < topics.length; i++) if (topics[i].id === id) return topics[i];
		return null;
	}

	function say(kind, text) {
		var log = document.getElementById("annoLog");
		var p = document.createElement("p");
		p.className = kind;
		p.textContent = text;
		log.appendChild(p);
		log.scrollTop = log.scrollHeight;
	}

	function ask(text) {
		text = (text || "").replace(/\s+/g, " ").trim();
		if (!text) return;
		say("me", text);
		say("anno", replyTo(text));
	}

	function boot() {
		var list = document.getElementById("annoQuestions");
		var panel = document.getElementById("annoPanel");
		var open = document.getElementById("annoOpen");
		var form = document.getElementById("annoForm");
		var input = document.getElementById("annoAsk");
		if (!list || !panel || !open) return;
		var i, btn;
		for (i = 0; i < topics.length; i++) {
			btn = document.createElement("button");
			btn.type = "button";
			btn.textContent = topics[i].q;
			btn.setAttribute("data-id", topics[i].id);
			list.appendChild(btn);
		}
		say("anno", "Ρώτα με για το εργαλείο, ή διάλεξε μια ερώτηση.");
		list.addEventListener("click", function (e) {
			var b = e.target && e.target.getAttribute ? e.target : null;
			if (!b || !b.getAttribute("data-id")) return;
			var topic = topicById(b.getAttribute("data-id"));
			if (!topic) return;
			lastId = topic.id;
			say("me", topic.q);
			say("anno", topic.a);
		});
		open.addEventListener("click", function () {
			var on = panel.classList.toggle("on");
			panel.setAttribute("aria-hidden", on ? "false" : "true");
			if (on && input) input.focus();
		});
		document.getElementById("annoClose").addEventListener("click", function () {
			panel.classList.remove("on");
			panel.setAttribute("aria-hidden", "true");
		});
		form.addEventListener("submit", function (e) {
			e.preventDefault();
			ask(input.value);
			input.value = "";
		});
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
	else boot();
})();
