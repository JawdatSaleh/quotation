// server.js - Main Express Server
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

// Initialize Express App
const app = express();

// Environment Variables
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_URL = process.env.PUBLIC_URL;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/quotepro';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRE = '7d';

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Static Frontend
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'arabic_quotation_platform.html'));
});

app.get('/editor', (req, res) => {
    res.sendFile(path.join(__dirname, 'arabic_template_editor.html'));
});

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// File Upload Configuration
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'uploads', req.user.id);
        await fs.mkdir(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|svg|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, GIF, SVG and PDF are allowed.'));
        }
    }
});

// MongoDB Connection
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// ==================== SCHEMAS ====================

// User Schema
const userSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'editor', 'viewer'], default: 'editor' },
    company: {
        name: String,
        logo: String,
        crNumber: String,
        vatNumber: String,
        address: String,
        city: String,
        state: String,
        zipCode: String,
        country: String,
        phone: String,
        email: String,
        website: String,
        socialMedia: {
            facebook: String,
            twitter: String,
            linkedin: String,
            instagram: String
        }
    },
    branding: {
        primaryColor: { type: String, default: '#4F46E5' },
        secondaryColor: { type: String, default: '#06B6D4' },
        fontFamily: { type: String, default: 'Inter' },
        logoPosition: { type: String, default: 'left' }
    },
    preferences: {
        language: { type: String, default: 'en' },
        currency: { type: String, default: 'SAR' },
        dateFormat: { type: String, default: 'DD/MM/YYYY' },
        vatRate: { type: Number, default: 15 },
        documentNumbering: {
            quotationPrefix: { type: String, default: 'QUO' },
            invoicePrefix: { type: String, default: 'INV' },
            proposalPrefix: { type: String, default: 'PRO' }
        }
    },
    subscription: {
        plan: { type: String, enum: ['free', 'basic', 'pro', 'enterprise'], default: 'free' },
        startDate: Date,
        endDate: Date,
        status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active' }
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastLogin: Date,
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    resetPasswordToken: String,
    resetPasswordExpire: Date
});

// Template Schema
const templateSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    type: { type: String, enum: ['quotation', 'invoice', 'proposal', 'contract'], required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isPublic: { type: Boolean, default: false },
    thumbnail: String,
    sections: [{
        type: { type: String, required: true },
        position: Number,
        content: mongoose.Schema.Types.Mixed,
        settings: mongoose.Schema.Types.Mixed
    }],
    settings: {
        pageSize: { type: String, default: 'A4' },
        orientation: { type: String, default: 'portrait' },
        margins: {
            top: { type: Number, default: 60 },
            right: { type: Number, default: 60 },
            bottom: { type: Number, default: 60 },
            left: { type: Number, default: 60 }
        },
        colors: {
            primary: String,
            secondary: String,
            text: String,
            background: String
        },
        fonts: {
            heading: String,
            body: String,
            size: Number
        }
    },
    usageCount: { type: Number, default: 0 },
    rating: { type: Number, default: 0 },
    tags: [String],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Document Schema
const documentSchema = new mongoose.Schema({
    documentNumber: { type: String, required: true, unique: true },
    type: { type: String, enum: ['quotation', 'invoice', 'proposal', 'contract'], required: true },
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    client: {
        name: String,
        company: String,
        email: String,
        phone: String,
        address: String,
        city: String,
        state: String,
        zipCode: String,
        country: String,
        vatNumber: String
    },
    project: {
        name: String,
        description: String,
        startDate: Date,
        endDate: Date,
        location: String
    },
    items: [{
        description: String,
        quantity: Number,
        unit: String,
        unitPrice: Number,
        discount: Number,
        tax: Number,
        total: Number
    }],
    totals: {
        subtotal: Number,
        discount: Number,
        tax: Number,
        total: Number
    },
    payment: {
        terms: String,
        method: String,
        schedule: [{
            milestone: String,
            percentage: Number,
            amount: Number,
            dueDate: Date,
            status: { type: String, enum: ['pending', 'paid', 'overdue'] }
        }]
    },
    status: {
        type: String,
        enum: ['draft', 'sent', 'viewed', 'approved', 'rejected', 'expired', 'paid'],
        default: 'draft'
    },
    validUntil: Date,
    notes: String,
    attachments: [String],
    signature: {
        client: {
            name: String,
            signedAt: Date,
            ip: String
        },
        company: {
            name: String,
            signedAt: Date
        }
    },
    emailHistory: [{
        sentAt: Date,
        recipient: String,
        subject: String,
        status: String
    }],
    viewHistory: [{
        viewedAt: Date,
        ip: String,
        userAgent: String
    }],
    version: { type: Number, default: 1 },
    previousVersions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Client Schema
const clientSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    company: String,
    email: { type: String, required: true },
    phone: String,
    mobile: String,
    address: String,
    city: String,
    state: String,
    zipCode: String,
    country: String,
    vatNumber: String,
    website: String,
    notes: String,
    tags: [String],
    documents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }],
    totalRevenue: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Models
const User = mongoose.model('User', userSchema);
const Template = mongoose.model('Template', templateSchema);
const Document = mongoose.model('Document', documentSchema);
const Client = mongoose.model('Client', clientSchema);

// ==================== MIDDLEWARE ====================

// Authentication Middleware
const authenticate = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            throw new Error();
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        
        if (!user || !user.isActive) {
            throw new Error();
        }

        req.user = user;
        req.token = token;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Please authenticate' });
    }
};

// Role-based Access Control
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        next();
    };
};

// ==================== ROUTES ====================

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ========== Authentication Routes ==========

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { firstName, lastName, email, password, company } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = new User({
            firstName,
            lastName,
            email,
            password: hashedPassword,
            company: {
                name: company
            }
        });

        await user.save();

        // Generate token
        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: JWT_EXPIRE });

        res.status(201).json({
            message: 'User created successfully',
            token,
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        // Generate token
        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: JWT_EXPIRE });

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: user.role,
                company: user.company
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Get Current User
app.get('/api/auth/me', authenticate, (req, res) => {
    res.json({
        user: req.user
    });
});

// Update Password
app.put('/api/auth/password', authenticate, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        const user = await User.findById(req.user.id);
        
        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        // Hash new password
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Password update error:', error);
        res.status(500).json({ error: 'Failed to update password' });
    }
});

// ========== User Settings Routes ==========

// Update Company Settings
app.put('/api/settings/company', authenticate, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        user.company = { ...user.company, ...req.body };
        user.updatedAt = new Date();
        await user.save();
        
        res.json({ message: 'Company settings updated', company: user.company });
    } catch (error) {
        console.error('Company settings error:', error);
        res.status(500).json({ error: 'Failed to update company settings' });
    }
});

// Upload Company Logo
app.post('/api/settings/logo', authenticate, upload.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const user = await User.findById(req.user.id);
        user.company.logo = `/uploads/${req.user.id}/${req.file.filename}`;
        await user.save();

        res.json({ message: 'Logo uploaded successfully', logoUrl: user.company.logo });
    } catch (error) {
        console.error('Logo upload error:', error);
        res.status(500).json({ error: 'Failed to upload logo' });
    }
});

// Update Branding Settings
app.put('/api/settings/branding', authenticate, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        user.branding = { ...user.branding, ...req.body };
        user.updatedAt = new Date();
        await user.save();
        
        res.json({ message: 'Branding settings updated', branding: user.branding });
    } catch (error) {
        console.error('Branding settings error:', error);
        res.status(500).json({ error: 'Failed to update branding settings' });
    }
});

// Update Preferences
app.put('/api/settings/preferences', authenticate, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        user.preferences = { ...user.preferences, ...req.body };
        user.updatedAt = new Date();
        await user.save();
        
        res.json({ message: 'Preferences updated', preferences: user.preferences });
    } catch (error) {
        console.error('Preferences error:', error);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

// ========== Template Routes ==========

// Get Templates
app.get('/api/templates', authenticate, async (req, res) => {
    try {
        const { type, isPublic, search, page = 1, limit = 20 } = req.query;
        
        const query = {
            $or: [
                { owner: req.user.id },
                { isPublic: true }
            ]
        };

        if (type) query.type = type;
        if (isPublic !== undefined) query.isPublic = isPublic === 'true';
        if (search) {
            query.$and = [
                { $or: [{ owner: req.user.id }, { isPublic: true }] },
                {
                    $or: [
                        { name: { $regex: search, $options: 'i' } },
                        { description: { $regex: search, $options: 'i' } },
                        { tags: { $in: [new RegExp(search, 'i')] } }
                    ]
                }
            ];
        }

        const templates = await Template.find(query)
            .populate('owner', 'firstName lastName company.name')
            .sort('-createdAt')
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Template.countDocuments(query);

        res.json({
            templates,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get templates error:', error);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

// Get Single Template
app.get('/api/templates/:id', authenticate, async (req, res) => {
    try {
        const template = await Template.findById(req.params.id)
            .populate('owner', 'firstName lastName company.name');

        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Check access
        if (!template.isPublic && template.owner._id.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({ template });
    } catch (error) {
        console.error('Get template error:', error);
        res.status(500).json({ error: 'Failed to fetch template' });
    }
});

// Create Template
app.post('/api/templates', authenticate, async (req, res) => {
    try {
        const template = new Template({
            ...req.body,
            owner: req.user.id
        });

        await template.save();

        res.status(201).json({ message: 'Template created', template });
    } catch (error) {
        console.error('Create template error:', error);
        res.status(500).json({ error: 'Failed to create template' });
    }
});

// Update Template
app.put('/api/templates/:id', authenticate, async (req, res) => {
    try {
        const template = await Template.findById(req.params.id);

        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Check ownership
        if (template.owner.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        Object.assign(template, req.body);
        template.updatedAt = new Date();
        await template.save();

        res.json({ message: 'Template updated', template });
    } catch (error) {
        console.error('Update template error:', error);
        res.status(500).json({ error: 'Failed to update template' });
    }
});

// Delete Template
app.delete('/api/templates/:id', authenticate, async (req, res) => {
    try {
        const template = await Template.findById(req.params.id);

        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Check ownership
        if (template.owner.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await template.remove();

        res.json({ message: 'Template deleted successfully' });
    } catch (error) {
        console.error('Delete template error:', error);
        res.status(500).json({ error: 'Failed to delete template' });
    }
});

// ========== Document Routes ==========

// Get Documents
app.get('/api/documents', authenticate, async (req, res) => {
    try {
        const { type, status, client, search, page = 1, limit = 20 } = req.query;
        
        const query = { owner: req.user.id };

        if (type) query.type = type;
        if (status) query.status = status;
        if (client) query['client.name'] = { $regex: client, $options: 'i' };
        if (search) {
            query.$or = [
                { documentNumber: { $regex: search, $options: 'i' } },
                { 'client.name': { $regex: search, $options: 'i' } },
                { 'project.name': { $regex: search, $options: 'i' } }
            ];
        }

        const documents = await Document.find(query)
            .populate('template', 'name')
            .sort('-createdAt')
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Document.countDocuments(query);

        res.json({
            documents,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get documents error:', error);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

// Get Single Document
app.get('/api/documents/:id', authenticate, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id)
            .populate('template')
            .populate('previousVersions');

        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // Check ownership
        if (document.owner.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({ document });
    } catch (error) {
        console.error('Get document error:', error);
        res.status(500).json({ error: 'Failed to fetch document' });
    }
});

// Create Document
app.post('/api/documents', authenticate, async (req, res) => {
    try {
        // Generate document number
        const prefix = req.user.preferences.documentNumbering[`${req.body.type}Prefix`] || 'DOC';
        const year = new Date().getFullYear();
        const count = await Document.countDocuments({
            owner: req.user.id,
            type: req.body.type,
            createdAt: {
                $gte: new Date(year, 0, 1),
                $lt: new Date(year + 1, 0, 1)
            }
        });
        
        const documentNumber = `${prefix}-${year}-${String(count + 1).padStart(3, '0')}`;

        const document = new Document({
            ...req.body,
            documentNumber,
            owner: req.user.id
        });

        await document.save();

        // Update client if provided
        if (req.body.clientId) {
            await Client.findByIdAndUpdate(req.body.clientId, {
                $push: { documents: document._id }
            });
        }

        res.status(201).json({ message: 'Document created', document });
    } catch (error) {
        console.error('Create document error:', error);
        res.status(500).json({ error: 'Failed to create document' });
    }
});

// Update Document
app.put('/api/documents/:id', authenticate, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);

        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // Check ownership
        if (document.owner.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Create version if significant changes
        if (req.body.createVersion) {
            const newVersion = new Document(document.toObject());
            delete newVersion._id;
            await newVersion.save();
            
            document.previousVersions.push(newVersion._id);
            document.version += 1;
        }

        Object.assign(document, req.body);
        document.updatedAt = new Date();
        await document.save();

        res.json({ message: 'Document updated', document });
    } catch (error) {
        console.error('Update document error:', error);
        res.status(500).json({ error: 'Failed to update document' });
    }
});

// Delete Document
app.delete('/api/documents/:id', authenticate, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);

        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // Check ownership
        if (document.owner.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await document.remove();

        res.json({ message: 'Document deleted successfully' });
    } catch (error) {
        console.error('Delete document error:', error);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});

// Export Document as PDF
app.get('/api/documents/:id/export/pdf', authenticate, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id)
            .populate('template')
            .populate('owner');

        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // Check ownership
        if (document.owner._id.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Generate PDF using Puppeteer
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        // Generate HTML from document data
        const html = generateDocumentHTML(document);
        
        await page.setContent(html, { waitUntil: 'networkidle0' });
        await page.emulateMediaType('print');

        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '60px',
                right: '60px',
                bottom: '60px',
                left: '60px'
            }
        });

        await browser.close();

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${document.documentNumber}.pdf"`,
            'Content-Length': pdf.length
        });

        res.send(pdf);
    } catch (error) {
        console.error('Export PDF error:', error);
        res.status(500).json({ error: 'Failed to export PDF' });
    }
});

// Send Document via Email
app.post('/api/documents/:id/send', authenticate, async (req, res) => {
    try {
        const { recipientEmail, subject, message } = req.body;
        
        const document = await Document.findById(req.params.id)
            .populate('owner');

        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // Check ownership
        if (document.owner._id.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Configure email transporter
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        // Generate PDF
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        const html = generateDocumentHTML(document);
        
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4' });
        await browser.close();

        // Send email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: recipientEmail,
            subject: subject || `${document.type.charAt(0).toUpperCase() + document.type.slice(1)} - ${document.documentNumber}`,
            html: message || `Please find attached the ${document.type} document.`,
            attachments: [{
                filename: `${document.documentNumber}.pdf`,
                content: pdf
            }]
        };

        await transporter.sendMail(mailOptions);

        // Update document email history
        document.emailHistory.push({
            sentAt: new Date(),
            recipient: recipientEmail,
            subject: mailOptions.subject,
            status: 'sent'
        });
        document.status = 'sent';
        await document.save();

        res.json({ message: 'Document sent successfully' });
    } catch (error) {
        console.error('Send document error:', error);
        res.status(500).json({ error: 'Failed to send document' });
    }
});

// ========== Client Routes ==========

// Get Clients
app.get('/api/clients', authenticate, async (req, res) => {
    try {
        const { search, status, page = 1, limit = 20 } = req.query;
        
        const query = { owner: req.user.id };

        if (status) query.status = status;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { company: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const clients = await Client.find(query)
            .sort('-createdAt')
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Client.countDocuments(query);

        res.json({
            clients,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get clients error:', error);
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});

// Create Client
app.post('/api/clients', authenticate, async (req, res) => {
    try {
        const client = new Client({
            ...req.body,
            owner: req.user.id
        });

        await client.save();

        res.status(201).json({ message: 'Client created', client });
    } catch (error) {
        console.error('Create client error:', error);
        res.status(500).json({ error: 'Failed to create client' });
    }
});

// Update Client
app.put('/api/clients/:id', authenticate, async (req, res) => {
    try {
        const client = await Client.findById(req.params.id);

        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Check ownership
        if (client.owner.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        Object.assign(client, req.body);
        client.updatedAt = new Date();
        await client.save();

        res.json({ message: 'Client updated', client });
    } catch (error) {
        console.error('Update client error:', error);
        res.status(500).json({ error: 'Failed to update client' });
    }
});

// Delete Client
app.delete('/api/clients/:id', authenticate, async (req, res) => {
    try {
        const client = await Client.findById(req.params.id);

        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Check ownership
        if (client.owner.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await client.remove();

        res.json({ message: 'Client deleted successfully' });
    } catch (error) {
        console.error('Delete client error:', error);
        res.status(500).json({ error: 'Failed to delete client' });
    }
});

// ========== Analytics Routes ==========

// Get Dashboard Stats
app.get('/api/analytics/dashboard', authenticate, async (req, res) => {
    try {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const [
            totalDocuments,
            monthlyDocuments,
            pendingApprovals,
            totalRevenue,
            activeClients,
            recentDocuments
        ] = await Promise.all([
            Document.countDocuments({ owner: req.user.id }),
            Document.countDocuments({
                owner: req.user.id,
                createdAt: { $gte: startOfMonth }
            }),
            Document.countDocuments({
                owner: req.user.id,
                status: { $in: ['sent', 'viewed'] }
            }),
            Document.aggregate([
                { $match: { owner: mongoose.Types.ObjectId(req.user.id) } },
                { $group: { _id: null, total: { $sum: '$totals.total' } } }
            ]),
            Client.countDocuments({ owner: req.user.id, status: 'active' }),
            Document.find({ owner: req.user.id })
                .sort('-createdAt')
                .limit(5)
                .populate('template', 'name')
        ]);

        res.json({
            stats: {
                totalDocuments,
                monthlyDocuments,
                pendingApprovals,
                totalRevenue: totalRevenue[0]?.total || 0,
                activeClients
            },
            recentDocuments
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

// ========== Helper Functions ==========

function generateDocumentHTML(document) {
    // This is a simplified HTML generator
    // In production, you'd use a proper template engine like Handlebars or EJS
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
                .header { border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 20px; }
                .company-name { font-size: 24px; font-weight: bold; }
                .document-title { font-size: 20px; margin: 20px 0; }
                table { width: 100%; border-collapse: collapse; }
                th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
                .total { font-size: 18px; font-weight: bold; text-align: right; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="company-name">${document.owner.company?.name || 'Company Name'}</div>
                <div>${document.owner.company?.address || ''}</div>
                <div>${document.owner.company?.phone || ''}</div>
            </div>
            
            <div class="document-title">
                ${document.type.toUpperCase()} - ${document.documentNumber}
            </div>
            
            <div class="client-info">
                <h3>Client Information</h3>
                <div>${document.client?.name || ''}</div>
                <div>${document.client?.company || ''}</div>
                <div>${document.client?.address || ''}</div>
            </div>
            
            <h3>Items</h3>
            <table>
                <thead>
                    <tr>
                        <th>Description</th>
                        <th>Quantity</th>
                        <th>Unit Price</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${document.items?.map(item => `
                        <tr>
                            <td>${item.description}</td>
                            <td>${item.quantity}</td>
                            <td>${item.unitPrice}</td>
                            <td>${item.total}</td>
                        </tr>
                    `).join('') || ''}
                </tbody>
            </table>
            
            <div class="total">
                Total: ${document.totals?.total || 0}
            </div>
        </body>
        </html>
    `;
}

// Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Start Server
app.listen(PORT, HOST, () => {
    const baseUrl = PUBLIC_URL || `http://${HOST === '0.0.0.0' ? '0.0.0.0' : HOST}:${PORT}`;
    console.log(`🚀 Server running at ${baseUrl}`);
    console.log(`📝 API Documentation: ${PUBLIC_URL ? `${PUBLIC_URL}/api-docs` : `${baseUrl}/api-docs`}`);
    if (!PUBLIC_URL && HOST === '0.0.0.0') {
        console.log('🌐 Update PUBLIC_URL with your public domain or IP to share the app over the internet.');
    }
});

module.exports = app;
