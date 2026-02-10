const jwt = require('jsonwebtoken');
const { User } = require('../models/user');

const userAuth = async (req, res, next) => {
    try {
        // Extract token from Authorization header (Bearer token)
        const authHeader = req.headers.authorization;
        let token = null;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1]; // Extract token from "Bearer TOKEN"
        }
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Login first - No token provided' 
            });
        }

        const decoded = jwt.verify(token, process.env.SECRET_KEY);
        const { id } = decoded;
        const user = await User.findById(id);

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        req.user = user;
        next();

    } catch (error) {
        console.error('Authentication error:', error);
        res.status(401).json({ 
            success: false, 
            message: error.message || 'Authentication failed' 
        });
    }
}

module.exports = {
    userAuth
};