const mongoose = require('mongoose');

const resortSchema = new mongoose.Schema({
    _id: {
        type: mongoose.Schema.Types.ObjectId,
        default: () => new mongoose.Types.ObjectId(),
    },
    name: {
        type: String,
        required: true,
        trim: true,
    },
    location: {
        type: String,
        default: null,
    },
    elevation: {
        type: Number,
        default: null,
    },
});

module.exports = mongoose.model('Resort', resortSchema);