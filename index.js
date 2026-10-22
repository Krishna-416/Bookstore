const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1234';

const express = require('express');
const app = express();
const port = Number(process.env.PORT) || 3000;

const mongooes = require('mongoose');
const multer = require('multer');
const nodemailer = require('nodemailer');
const session = require('express-session');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bookstore';
const DEFAULT_BOOK_IMAGE = '/default-book-cover.svg';
let memoryMode = false;
let memorySequence = 0;
const inMemoryBooks = [];
const inMemoryCategories = [];

function sortRows(rows, sortRules = {}) {
    const rules = Object.entries(sortRules || {});
    return [...rows].sort((left, right) => {
        for (const [field, direction] of rules) {
            const leftValue = left[field];
            const rightValue = right[field];
            const multiplier = direction === -1 ? -1 : 1;

            if (field === '_id') {
                const leftSortValue = Number(String(leftValue).split('-')[0] || 0);
                const rightSortValue = Number(String(rightValue).split('-')[0] || 0);
                if (leftSortValue !== rightSortValue) {
                    return (leftSortValue - rightSortValue) * multiplier;
                }
                continue;
            }

            if (leftValue < rightValue) return -1 * multiplier;
            if (leftValue > rightValue) return 1 * multiplier;
        }
        return 0;
    });
}

function buildMemoryCollectionModel(collectionName, seed = []) {
    function MemoryItem(data = {}) {
        const item = { ...data };
        item._id = item._id || `${Date.now()}-${++memorySequence}`;
        item.__order = item.__order ?? Date.now() + memorySequence;
        Object.assign(this, item);
    }

    MemoryItem.prototype.toObject = function () {
        return { ...this };
    };

    MemoryItem.prototype.save = async function () {
        const target = (collectionName === 'Book' ? inMemoryBooks : inMemoryCategories).find(item => String(item._id) === String(this._id));
        if (target) {
            Object.assign(target, this);
            return target;
        }

        const item = { ...this };
        item.__order = Date.now() + ++memorySequence;
        (collectionName === 'Book' ? inMemoryBooks : inMemoryCategories).push(item);
        return item;
    };

    MemoryItem.find = function (filter = {}) {
        const records = (collectionName === 'Book' ? inMemoryBooks : inMemoryCategories)
            .filter((item) => {
                if (!filter || Object.keys(filter).length === 0) {
                    return true;
                }
                return Object.entries(filter).every(([key, value]) => String(item[key]) === String(value));
            });

        const query = {
            items: records,
            sort(sortRules = {}) {
                this.items = sortRows(this.items, sortRules);
                return this;
            },
            limit(limitValue) {
                if (Number.isFinite(limitValue)) {
                    this.items = this.items.slice(0, limitValue);
                }
                return this;
            },
            then(onFulfilled, onRejected) {
                return Promise.resolve(this.items).then(onFulfilled, onRejected);
            }
        };

        return query;
    };

    MemoryItem.findById = async function (id) {
        const records = collectionName === 'Book' ? inMemoryBooks : inMemoryCategories;
        return records.find(item => String(item._id) === String(id)) || null;
    };

    MemoryItem.findByIdAndDelete = async function (id) {
        const records = collectionName === 'Book' ? inMemoryBooks : inMemoryCategories;
        const index = records.findIndex(item => String(item._id) === String(id));
        if (index === -1) return null;
        const [deleted] = records.splice(index, 1);
        return deleted;
    };

    MemoryItem.distinct = async function (field) {
        const records = collectionName === 'Book' ? inMemoryBooks : inMemoryCategories;
        return [...new Set(records.map(item => item[field]).filter(Boolean))];
    };

    MemoryItem.updateOne = async function (filter, update, options = {}) {
        const records = collectionName === 'Book' ? inMemoryBooks : inMemoryCategories;
        const existing = records.find((item) => Object.entries(filter).every(([key, value]) => String(item[key]) === String(value)));

        if (existing) {
            Object.assign(existing, update.$set || update);
            if (update.$setOnInsert && !existing._id) {
                Object.assign(existing, update.$setOnInsert);
            }
            return { acknowledged: true, upserted: null, matchedCount: 1, modifiedCount: 1 };
        }

        if (options.upsert) {
            const inserted = { ...(update.$setOnInsert || update.$set || filter) };
            inserted._id = `${Date.now()}-${++memorySequence}`;
            inserted.__order = Date.now() + memorySequence;
            records.push(inserted);
            return { acknowledged: true, upserted: inserted._id, matchedCount: 0, modifiedCount: 1 };
        }

        return { acknowledged: true, upserted: null, matchedCount: 0, modifiedCount: 0 };
    };

    if (Array.isArray(seed)) {
        seed.forEach((item) => {
            const record = { ...item };
            record._id = record._id || `${Date.now()}-${++memorySequence}`;
            record.__order = record.__order ?? Date.now() + memorySequence;
            if (collectionName === 'Book') {
                inMemoryBooks.push(record);
            } else {
                inMemoryCategories.push(record);
            }
        });
    }

    return MemoryItem;
}

const bookschema = mongooes.Schema({
    title: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, required: true, trim: true },
    img: { type: String, default: DEFAULT_BOOK_IMAGE }
});

let Book;
let Category;

async function connectDB() {
    try {
        await mongooes.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
        console.log('DB Connected');
        memoryMode = false;
        Book = mongooes.model('Book', bookschema);
        Category = mongooes.model('Category', new mongooes.Schema({
            name: { type: String, required: true, unique: true, trim: true }
        }));
    } catch (error) {
        memoryMode = true;
        console.warn(`MongoDB connection failed (${error.name}). Running in memory mode; changes will not be saved after restart.`);
        Book = buildMemoryCollectionModel('Book');
        Category = buildMemoryCollectionModel('Category');
    }
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, 'public', 'uploads'));
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER || '',
        pass: process.env.GMAIL_APP_PASSWORD || ''
    }
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'bookstoresecret',
    resave: false,
    saveUninitialized: false
}));

app.use((req, res, next) => {
    res.locals.isAdmin = !!req.session.isAdmin;
    res.locals.cartItemCount = Object.values(req.session.cart || {}).reduce((total, quantity) => {
        const parsedQuantity = Number(quantity);
        return total + (Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 0);
    }, 0);
    next();
});

function isAdmin(req, res, next) {
    if (req.session.isAdmin) {
        next();
    } else {
        res.status(403).send('Access denied. Sign in as an administrator to continue.');
    }
}

function normalizeBookImage(imagePath) {
    if (!imagePath) {
        return DEFAULT_BOOK_IMAGE;
    }

    return imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
}

async function getCatalogCategories() {
    const [savedCategories, bookCategories] = await Promise.all([
        Category.find().sort({ name: 1 }),
        Book.distinct('category')
    ]);
    return [...new Set([
        ...savedCategories.map(category => category.name),
        ...bookCategories.filter(Boolean)
    ])].sort((left, right) => left.localeCompare(right));
}

app.get('/', async (req, res) => {
    const [books, categories] = await Promise.all([
        Book.find().sort({ _id: -1 }).limit(4),
        getCatalogCategories()
    ]);
    res.render('home', { books, categories });
});

app.get('/admin/login', (req, res) => {
    res.render('adminlogin');
});

app.post('/admin/login', (req, res) => {
    const username = req.body.username;
    const password = req.body.password;

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.redirect('/books');
    } else {
        res.send('Invalid Username or Password');
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/about', (req, res) => {
    res.render('about');
});

app.get('/cart', async (req, res) => {
    const cart = req.session.cart || {};
    const entries = await Promise.all(Object.entries(cart).map(async ([id, quantity]) => {
        const book = await Book.findById(id);
        if (!book) {
            delete cart[id];
            return null;
        }
        return { book, quantity };
    }));
    const items = entries.filter(Boolean);
    const total = items.reduce((sum, item) => sum + Number(item.book.price) * item.quantity, 0);
    res.render('cart', { items, total });
});

app.post('/cart/add/:id', async (req, res) => {
    const book = await Book.findById(req.params.id);
    if (!book) {
        return res.status(404).send('Book not found');
    }

    const cart = req.session.cart || (req.session.cart = {});
    const currentQuantity = cart[req.params.id] || 0;
    if (!Number.isSafeInteger(currentQuantity) || currentQuantity < 0 || currentQuantity === Number.MAX_SAFE_INTEGER) {
        return res.status(400).send('Cart quantity cannot be increased.');
    }
    cart[req.params.id] = currentQuantity + 1;
    res.redirect('/cart');
});

app.post('/cart/update/:id', async (req, res) => {
    const cart = req.session.cart;
    if (!cart || !Object.prototype.hasOwnProperty.call(cart, req.params.id)) {
        return res.status(404).send('Book is not in your cart.');
    }

    const quantity = Number(req.body.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
        return res.status(400).send('Enter a valid quantity of at least 1.');
    }

    const book = await Book.findById(req.params.id);
    if (!book) {
        delete cart[req.params.id];
        return res.status(404).send('Book not found');
    }

    cart[req.params.id] = quantity;
    res.redirect('/cart');
});

app.post('/cart/remove/:id', (req, res) => {
    if (req.session.cart) {
        delete req.session.cart[req.params.id];
    }
    res.redirect('/cart');
});

app.get('/books', async (req, res) => {
    const books = await Book.find().sort({ _id: -1 });
    res.render('books', { books, isAdmin: !!req.session.isAdmin });
});

app.get('/books/new', isAdmin, async (req, res) => {
    const categories = await getCatalogCategories();
    res.render('newbook', { categories });
});

app.post('/books', isAdmin, upload.single('img'), async (req, res) => {
    const title = req.body.title?.trim();
    const author = req.body.author?.trim();
    const category = req.body.category?.trim();
    const price = Number(req.body.price);

    if (!title || !author || !category || !Number.isFinite(price) || price < 0) {
        return res.status(400).send('Enter a title, author, valid price, and category.');
    }

    await Category.updateOne({ name: category }, { $setOnInsert: { name: category } }, { upsert: true });
    const book = new Book({
        title,
        author,
        price,
        category,
        img: req.file ? `/uploads/${req.file.filename}` : DEFAULT_BOOK_IMAGE
    });
    await book.save();
    res.redirect('/books');
});

app.get('/books/edit/:id', isAdmin, async (req, res) => {
    const id = req.params.id;
    const book = await Book.findById(id);

    if (!book) {
        return res.status(404).send('Book not found');
    }

    res.render('editbook', { book: { ...book.toObject(), img: normalizeBookImage(book.img) } });
});

app.post('/books/edit/:id', isAdmin, upload.single('img'), async (req, res) => {
    const id = req.params.id;
    const book = await Book.findById(id);

    if (!book) {
        return res.status(404).send('Book not found');
    }

    book.title = req.body.title;
    book.author = req.body.author;
    book.price = Number(req.body.price);
    book.category = req.body.category?.trim();

    if (!book.title?.trim() || !book.author?.trim() || !book.category || !Number.isFinite(book.price) || book.price < 0) {
        return res.status(400).send('Enter a title, author, valid price, and category.');
    }

    if (req.file) {
        book.img = `/uploads/${req.file.filename}`;
    }

    await Category.updateOne({ name: book.category }, { $setOnInsert: { name: book.category } }, { upsert: true });
    await book.save();
    res.redirect('/books');
});

app.post('/books/delete/:id', isAdmin, async (req, res) => {
    const id = req.params.id;

    try {
        await Book.findByIdAndDelete(id);
        res.redirect('/books');
    } catch (error) {
        console.error('Failed to delete book:', error.message);
        res.status(500).send('Book could not be deleted');
    }
});

app.get('/category', async (req, res) => {
    const [books, categories] = await Promise.all([
        Book.find().sort({ _id: -1 }),
        getCatalogCategories()
    ]);
    res.render('categories', { books, categories, selectedCategory: null });
});

app.get('/category/:category', async (req, res) => {
    const category = req.params.category;
    const [books, categories] = await Promise.all([
        Book.find({ category }).sort({ _id: -1 }),
        getCatalogCategories()
    ]);
    res.render('categories', { books, categories, selectedCategory: category });
});

app.post('/category', isAdmin, async (req, res) => {
    const name = req.body.name?.trim();
    if (!name) {
        return res.status(400).send('Enter a category name.');
    }

    await Category.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true });
    res.redirect('/category');
});

app.get('/contact', (req, res) => {
    res.render('contact');
});

app.post('/contact', (req, res) => {
    const name = req.body.name;
    const email = req.body.email;
    const phone = req.body.phone;
    const message = req.body.message;

    transporter.sendMail({
        to: 'tharshit390@gmail.com',
        subject: 'New Customer Message',
        text: `Name: ${name} Email: ${email} Phone: ${phone} Message: ${message}`
    }, (error) => {
        if (error) {
            console.log(error);
            res.send('Email not sent');
        } else {
            res.send(`<script>
                    alert("Message Sent Successfully!");
                    window.location.href = "/contact";
                </script>`);
        }
    });
});

app.use((error, req, res, next) => {
    console.error('Request failed:', error);
    if (res.headersSent) {
        return next(error);
    }
    res.status(500).send('Something went wrong while loading or saving data. Check the server and MongoDB connection, then try again.');
});

async function startServer() {
    await connectDB();
    app.listen(port, () => {
        console.log('Listening on ' + port);
    });
}

if (require.main === module) {
    startServer().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { app, Book, Category, connectDB, startServer, normalizeBookImage };
