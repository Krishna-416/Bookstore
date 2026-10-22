(() => {
    const root = document.documentElement;
    const themeToggle = document.querySelector('[data-theme-toggle]');
    const menuToggle = document.querySelector('[data-menu-toggle]');
    const navigation = document.querySelector('.nav-links');

    let savedTheme = 'light';
    try {
        savedTheme = localStorage.getItem('readme-theme') || 'light';
    } catch (error) {
        console.error('Could not read the saved color theme:', error);
    }

    const setTheme = (theme, persist = false) => {
        const isDark = theme === 'dark';
        root.dataset.theme = isDark ? 'dark' : 'light';

        if (themeToggle) {
            themeToggle.setAttribute('aria-pressed', String(isDark));
            themeToggle.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} theme`);
            themeToggle.innerHTML = `<span aria-hidden="true">${isDark ? '☀' : '☾'}</span>`;
        }

        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) {
            themeColor.setAttribute('content', isDark ? '#171b18' : '#f7f5f0');
        }

        if (persist) {
            try {
                localStorage.setItem('readme-theme', isDark ? 'dark' : 'light');
            } catch (error) {
                console.error('Could not save the selected color theme:', error);
            }
        }
    };

    setTheme(savedTheme);
    themeToggle?.addEventListener('click', () => {
        setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
    });

    menuToggle?.addEventListener('click', () => {
        const isOpen = navigation?.classList.toggle('is-open') || false;
        menuToggle.setAttribute('aria-expanded', String(isOpen));
    });

    navigation?.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navigation.classList.remove('is-open');
            menuToggle?.setAttribute('aria-expanded', 'false');
        });
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && navigation?.classList.contains('is-open')) {
            navigation.classList.remove('is-open');
            menuToggle?.setAttribute('aria-expanded', 'false');
            menuToggle?.focus();
        }
    });

    const catalog = document.querySelector('[data-catalog-controls]');
    if (!catalog) return;

    const search = catalog.querySelector('[data-book-search]');
    const sort = catalog.querySelector('[data-book-sort]');
    const grid = document.querySelector('.catalog-grid');
    const count = document.querySelector('[data-catalog-count]');
    const noMatches = document.querySelector('[data-search-empty]');
    const cards = Array.from(grid?.querySelectorAll('[data-book-card]') || []);
    const originalOrder = new Map(cards.map((card, index) => [card, index]));
    const total = cards.length;

    const updateCatalog = () => {
        const query = search.value.trim().toLocaleLowerCase();
        let visible = 0;

        cards.forEach(card => {
            const searchableText = [
                card.dataset.title,
                card.dataset.author,
                card.dataset.category
            ].join(' ').toLocaleLowerCase();
            const matches = searchableText.includes(query);
            card.hidden = !matches;
            if (matches) visible += 1;
        });

        const sortMode = sort.value;
        cards.sort((left, right) => {
            if (sortMode === 'title') {
                return left.dataset.title.localeCompare(right.dataset.title);
            }
            if (sortMode === 'price-low') {
                return Number(left.dataset.price) - Number(right.dataset.price);
            }
            if (sortMode === 'price-high') {
                return Number(right.dataset.price) - Number(left.dataset.price);
            }
            return originalOrder.get(left) - originalOrder.get(right);
        }).forEach(card => grid.appendChild(card));

        count.textContent = `${visible} ${visible === 1 ? 'book' : 'books'} ${query ? 'found' : 'on the shelf'}`;
        noMatches.hidden = total === 0 || visible !== 0;
    };

    search.addEventListener('input', updateCatalog);
    sort.addEventListener('change', updateCatalog);
})();
