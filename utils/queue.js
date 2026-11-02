const {sleep} = require('./general');
const {QUEUE_RATE_LIMIT_DELAY} = require('../constants/generalConstant');

class Queue {
  constructor({RATE_LIMIT_DELAY = QUEUE_RATE_LIMIT_DELAY}) {
    this.RATE_LIMIT_DELAY = RATE_LIMIT_DELAY;
  }

  queue = [];
  isProcessing = false; // state for tracking processing state, false means processor is FREE

  /**
   * Add an item to the queue
   * @param {Object} action - action function that will be executed in queue
   * @returns {Promise} - Resolves when task is executed successfully, rejects on error
   */
  add = ({action}) => {
    // eslint-disable-next-line local-rules/enforce-single-object-param
    return new Promise((resolve, reject) => {
      this.addItemToQueue({action, resolve, reject});

      // Start processing if not already running
      if (!this.isBusy()) this.process();
    });
  };

  /**
   * Process the queue sequentially in a loop
   * Continues until queue is completely drained
   */
  process = async () => {
    if (this.isBusy()) return; // it means processor is BUSY, so exit immediately

    this.setIsBusy({value: true}); // 🔴 Mark as BUSY

    // if queue is not empty then start processing
    while (!this.getIsQueueEmpty()) {
      const item = this.getNextItem();

      const {action, resolve, reject} = item;

      try {
        const response = await action();

        resolve(response);
      } catch (error) {
        reject(error);
      }

      // Only sleep if there are more items to process (rate limiting between items)
      await sleep({time: this.RATE_LIMIT_DELAY});
    }

    this.setIsBusy({value: false}); // 🟢 Mark as FREE - done!
  };

  /**
   * Get empty status of the queue
   * @returns {boolean} - True if queue is empty, false otherwise
   */
  getIsQueueEmpty = () => this.queue.length === 0;

  /**
   * Get the next item from the queue
   * @returns {Object|null} - Next item object or null if queue is empty
   */
  getNextItem = () => this.queue.shift();

  /**
   * Add item to the queue
   * @param {Object} action - action contain any function to be executed
   */
  addItemToQueue = ({action, resolve, reject}) => {
    this.queue.push({action, resolve, reject});
  };

  /**
   * Set value for processing state
   * @param {Object} value - Object containing boolean value to set isProcessing
   */
  setIsBusy = ({value}) => {
    this.isProcessing = value;
  };

  /**
   * Get if process is in busy state
   * @returns {Boolean} value - True if processing, false otherwise
   */
  isBusy = () => {
    return this.isProcessing;
  };
}

module.exports = Queue;
