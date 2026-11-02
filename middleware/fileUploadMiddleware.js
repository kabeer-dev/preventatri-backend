const path = require('path');

const multer = require('multer');

const {GeneralErrorsFactories} = require('../factories');

// Define the middleware function that accepts options
module.exports = ({
  allowedTypes = [], // Default to allow all types if not specified
  fileSizeLimit = 5 * 1024 * 1024, // 5 MB limit
  require = true, // Default to require a file upload if not specified
  multiple = false, // Default to single file upload if not specified
  anyFieldName = false, // Accept files from any field name (for dynamic field names like images_<questionId>)
  maxFiles = undefined,
}) => {
  // Use memory storage to keep files in memory
  const storage = multer.memoryStorage();

  // Define a file filter based on allowed file types
  const fileFilter = (req, file, cb) => {
    const timestamp = Date.now(); // Get the current timestamp
    const fileExtension = path.extname(file.originalname); // Extract the file extension

    let filenameWithoutExtension = path.basename(
      file.originalname,
      path.extname(file.originalname)
    ); // Extract the filename without extension

    const filename = `${filenameWithoutExtension}.${timestamp}${fileExtension}`; // Concatenate the timestamp and file extension
    file.originalname = filename; // Set the new filename with timestamp

    // Check if the file type is allowed
    if (!allowedTypes.length || allowedTypes.includes(file.mimetype)) {
      // Allow the file upload if it is an allowed type or if no types are restricted
      cb(null, true);
    } else {
      // Reject the file upload if it is not an allowed type
      return cb(
        GeneralErrorsFactories.fileTypeNotAllowedErr({
          allowedTypes: allowedTypes.join(', '),
        }),
        false
      );
    }
  };

  // Create a Multer instance with storage in memory, file filter, and limits
  const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: Object.assign(
      {fileSize: fileSizeLimit},
      maxFiles !== undefined ? {files: maxFiles} : {}
    ),
  });

  // Return a middleware function that handles single, multiple, or any file uploads
  return (req, res, next) => {
    // Determine the upload function based on the options
    let uploadFn;
    if (anyFieldName) {
      uploadFn = upload.any();
    } else if (multiple) {
      uploadFn = upload.array('files');
    } else {
      uploadFn = upload.single('file');
    }

    // Invoke the upload function
    uploadFn(req, res, (error) => {
      if (error) {
        if (error instanceof multer.MulterError) {
          return next(
            GeneralErrorsFactories.badRequestErr({customMessage: error.message})
          );
        }

        return next(error);
      }
      if (multiple || anyFieldName) {
        if ((!req.files || req.files.length === 0) && require)
          return next(GeneralErrorsFactories.fileNotFoundErr());
      }

      if (!multiple && !anyFieldName && !req.file && require)
        return next(GeneralErrorsFactories.fileNotFoundErr());

      // Proceed to the next middleware or controller if the file upload is successful
      next();
    });
  };
};
