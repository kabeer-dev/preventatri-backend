const {MongosFactory, PrismaFactory} = require('../factories');

// Use Prisma by default, fall back to MongoDB if needed
const Factory = PrismaFactory || MongosFactory;

module.exports = class GeneralServices {
  static async create({model, data, options, tx}) {
    return await Factory.create({
      model,
      data,
      options,
      tx,
    });
  }

  static async find({model, query, options, fieldsInclusion, populateFields}) {
    return await Factory.find({
      model,
      query,
      options,
      fieldsInclusion,
      populateFields,
    });
  }

  // Alias for find - for API compatibility
  static async findAll({
    model,
    query,
    options,
    fieldsInclusion,
    populateFields,
  }) {
    return await Factory.find({
      model,
      query,
      options,
      fieldsInclusion,
      populateFields,
    });
  }

  // findById - find by document ID
  static async findById({model, id, options, fieldsInclusion, populateFields}) {
    return await Factory.findById({
      model,
      id,
      options,
      fieldsInclusion,
      populateFields,
    });
  }

  static async findOne({
    model,
    query,
    options,
    fieldsInclusion,
    populateFields,
  }) {
    // query can be for example {id} , {status: "active"}
    return await Factory.findOne({
      model,
      query,
      options,
      fieldsInclusion,
      populateFields,
    });
  }

  static async updateOne({model, query, data, options}) {
    return await Factory.updateOne({
      model,
      query,
      data,
      options,
    });
  }

  static async updateMany({model, query, data, options}) {
    return await Factory.updateMany({
      model,
      query,
      data,
      options,
    });
  }

  static async findAllByUserId({
    model,
    id,
    options,
    fieldsInclusion,
    populateFields,
  }) {
    // Method for finding all documents associated with a login user
    let query = {userId: id};

    return await Factory.find({
      model,
      query,
      options,
      fieldsInclusion,
      populateFields,
    });
  }

  static async findOneAndUpdate({
    model,
    query,
    data,
    options,
    fieldsInclusion,
    populateFields,
  }) {
    // query can be for example {id} , {status: "active"}
    return await Factory.findOneAndUpdate({
      model,
      query,
      data,
      options,
      fieldsInclusion,
      populateFields,
    });
  }

  static async findByIdAndUpdate({
    model,
    id,
    data,
    options,
    fieldsInclusion,
    populateFields,
  }) {
    return await Factory.findByIdAndUpdate({
      model,
      id,
      data,
      options,
      fieldsInclusion,
      populateFields,
    });
  }

  static async findAllAndUpdate({
    model,
    query,
    data,
    options,
    fieldsInclusion,
    populateFields,
  }) {
    return await Factory.findAllAndUpdate({
      model,
      query,
      data,
      options,
      fieldsInclusion,
      populateFields,
    });
  }

  static async findOneAndDelete({
    model,
    query,
    options,
    fieldsInclusion,
    populateFields,
  }) {
    // query can be for example {id} , {status: "active"}
    return await Factory.softDeleteOne({
      model,
      query,
      options,
      fieldsInclusion,
      populateFields,
    });
  }

  static async findByIdAndDelete({
    model,
    id,
    options,
    fieldsInclusion,
    populateFields,
  }) {
    return await Factory.softDeleteById({
      model,
      id,
      options,
      fieldsInclusion,
      populateFields,
    });
  }

  static async findAllAndDelete({model, query, options}) {
    return await Factory.findAllAndDelete({
      model,
      query,
      options,
    });
  }

  static async aggregate({model, pipeline, options}) {
    return await Factory.aggregate({
      model,
      pipeline,
      options,
    });
  }

  static async countDocuments({model, query, options}) {
    return await Factory.countDocuments({
      model,
      query,
      options,
    });
  }
};
