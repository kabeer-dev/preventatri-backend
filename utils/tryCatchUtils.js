module.exports.tryCatch = ({fn}) => {
  try {
    const response = fn();

    return {success: true, response};
  } catch (error) {
    return {success: false, error};
  }
};

module.exports.asyncTryCatch = async ({fn}) => {
  try {
    const response = await fn();

    return {success: true, response};
  } catch (error) {
    return {success: false, error};
  }
};
