'use strict';

var async = require('async');
var utils = require('../../utils');

module.exports = function (db, module) {
	var helpers = require('./helpers');

	require('./sorted/add')(db, module);
	require('./sorted/remove')(db, module);
	require('./sorted/union')(db, module);
	require('./sorted/intersect')(db, module);

	module.getSortedSetRange = async function (key, start, stop) {
		return await getSortedSetRange(key, start, stop, '-inf', '+inf', 1, false);
	};

	module.getSortedSetRevRange = async function (key, start, stop) {
		return await getSortedSetRange(key, start, stop, '-inf', '+inf', -1, false);
	};

	module.getSortedSetRangeWithScores = async function (key, start, stop) {
		return await getSortedSetRange(key, start, stop, '-inf', '+inf', 1, true);
	};

	module.getSortedSetRevRangeWithScores = async function (key, start, stop) {
		return await getSortedSetRange(key, start, stop, '-inf', '+inf', -1, true);
	};

	async function getSortedSetRange(key, start, stop, min, max, sort, withScores) {
		if (!key) {
			return;
		}
		const isArray = Array.isArray(key);
		if ((start < 0 && start > stop) || (isArray && !key.length)) {
			return [];
		}

		if (isArray) {
			if (key.length > 1) {
				key = { $in: key };
			} else {
				key = key[0];
			}
		}

		var query = { _key: key };

		if (min !== '-inf') {
			query.score = { $gte: min };
		}
		if (max !== '+inf') {
			query.score = query.score || {};
			query.score.$lte = max;
		}

		if (max === min) {
			query.score = max;
		}

		const fields = { _id: 0, _key: 0 };
		if (!withScores) {
			fields.score = 0;
		}

		var reverse = false;
		if (start === 0 && stop < -1) {
			reverse = true;
			sort *= -1;
			start = Math.abs(stop + 1);
			stop = -1;
		} else if (start < 0 && stop > start) {
			var tmp1 = Math.abs(stop + 1);
			stop = Math.abs(start + 1);
			start = tmp1;
		}

		var limit = stop - start + 1;
		if (limit <= 0) {
			limit = 0;
		}

		let data = await db.collection('objects').find(query, { projection: fields })
			.sort({ score: sort })
			.skip(start)
			.limit(limit)
			.toArray();

		if (reverse) {
			data.reverse();
		}
		if (!withScores) {
			data = data.map(item => item.value);
		}

		return data;
	}

	module.getSortedSetRangeByScore = async function (key, start, count, min, max) {
		return await getSortedSetRangeByScore(key, start, count, min, max, 1, false);
	};

	module.getSortedSetRevRangeByScore = async function (key, start, count, max, min) {
		return await getSortedSetRangeByScore(key, start, count, min, max, -1, false);
	};

	module.getSortedSetRangeByScoreWithScores = async function (key, start, count, min, max) {
		return await getSortedSetRangeByScore(key, start, count, min, max, 1, true);
	};

	module.getSortedSetRevRangeByScoreWithScores = async function (key, start, count, max, min) {
		return await getSortedSetRangeByScore(key, start, count, min, max, -1, true);
	};

	async function getSortedSetRangeByScore(key, start, count, min, max, sort, withScores) {
		if (parseInt(count, 10) === 0) {
			return [];
		}
		const stop = (parseInt(count, 10) === -1) ? -1 : (start + count - 1);
		return await getSortedSetRange(key, start, stop, min, max, sort, withScores);
	}

	module.sortedSetCount = async function (key, min, max) {
		if (!key) {
			return;
		}

		var query = { _key: key };
		if (min !== '-inf') {
			query.score = { $gte: min };
		}
		if (max !== '+inf') {
			query.score = query.score || {};
			query.score.$lte = max;
		}

		const count = await db.collection('objects').countDocuments(query);
		return count || 0;
	};

	module.sortedSetCard = async function (key) {
		if (!key) {
			return 0;
		}
		const count = await db.collection('objects').countDocuments({ _key: key });
		return parseInt(count, 10) || 0;
	};

	module.sortedSetsCard = async function (keys) {
		if (!Array.isArray(keys) || !keys.length) {
			return [];
		}
		const promises = keys.map(k => module.sortedSetCard(k));
		return await Promise.all(promises);
	};

	module.sortedSetsCardSum = async function (keys) {
		if (!keys || (Array.isArray(keys) && !keys.length)) {
			return 0;
		}

		const count = await db.collection('objects').countDocuments({ _key: Array.isArray(keys) ? { $in: keys } : keys });
		return parseInt(count, 10) || 0;
	};

	module.sortedSetRank = function (key, value, callback) {
		getSortedSetRank(false, key, value, callback);
	};

	module.sortedSetRevRank = function (key, value, callback) {
		getSortedSetRank(true, key, value, callback);
	};

	function getSortedSetRank(reverse, key, value, callback) {
		if (!key) {
			return callback();
		}
		value = helpers.valueToString(value);
		module.sortedSetScore(key, value, function (err, score) {
			if (err || score === null) {
				return callback(err, null);
			}

			db.collection('objects').countDocuments({
				$or: [
					{
						_key: key,
						score: reverse ? { $gt: score } : { $lt: score },
					},
					{
						_key: key,
						score: score,
						value: reverse ? { $gt: value } : { $lt: value },
					},
				],
			}, function (err, rank) { callback(err, rank); });
		});
	}

	module.sortedSetsRanks = function (keys, values, callback) {
		sortedSetsRanks(module.sortedSetRank, keys, values, callback);
	};

	module.sortedSetsRevRanks = function (keys, values, callback) {
		sortedSetsRanks(module.sortedSetRevRank, keys, values, callback);
	};

	function sortedSetsRanks(method, keys, values, callback) {
		if (!Array.isArray(keys) || !keys.length) {
			return callback(null, []);
		}
		var data = new Array(values.length);
		for (var i = 0; i < values.length; i += 1) {
			data[i] = { key: keys[i], value: values[i] };
		}

		async.map(data, function (item, next) {
			method(item.key, item.value, next);
		}, callback);
	}

	module.sortedSetRanks = function (key, values, callback) {
		sortedSetRanks(module.getSortedSetRange, key, values, callback);
	};

	module.sortedSetRevRanks = function (key, values, callback) {
		sortedSetRanks(module.getSortedSetRevRange, key, values, callback);
	};

	function sortedSetRanks(method, key, values, callback) {
		method(key, 0, -1, function (err, sortedSet) {
			if (err) {
				return callback(err);
			}

			var result = values.map(function (value) {
				if (!value) {
					return null;
				}
				var index = sortedSet.indexOf(value.toString());
				return index !== -1 ? index : null;
			});

			callback(null, result);
		});
	}

	module.sortedSetScore = async function (key, value) {
		if (!key) {
			return null;
		}
		value = helpers.valueToString(value);
		const result = await db.collection('objects').findOne({ _key: key, value: value }, { projection: { _id: 0, _key: 0, value: 0 } });
		return result ? result.score : null;
	};

	module.sortedSetsScore = async function (keys, value) {
		if (!Array.isArray(keys) || !keys.length) {
			return [];
		}
		value = helpers.valueToString(value);
		const result = await db.collection('objects').find({ _key: { $in: keys }, value: value }, { projection: { _id: 0, value: 0 } }).toArray();
		var map = {};
		result.forEach(function (item) {
			if (item) {
				map[item._key] = item;
			}
		});

		return keys.map(key => (map[key] ? map[key].score : null));
	};

	module.sortedSetScores = async function (key, values) {
		if (!key) {
			return null;
		}
		if (!values.length) {
			return [];
		}
		values = values.map(helpers.valueToString);
		const result = await db.collection('objects').find({ _key: key, value: { $in: values } }, { projection: { _id: 0, _key: 0 } }).toArray();

		var valueToScore = {};
		result.forEach(function (item) {
			if (item) {
				valueToScore[item.value] = item.score;
			}
		});

		return values.map(v => (utils.isNumber(valueToScore[v]) ? valueToScore[v] : null));
	};

	module.isSortedSetMember = function (key, value, callback) {
		if (!key) {
			return callback();
		}
		value = helpers.valueToString(value);
		db.collection('objects').findOne({ _key: key, value: value }, { projection: { _id: 0, _key: 0, score: 0 } }, function (err, result) {
			callback(err, !!result);
		});
	};

	module.isSortedSetMembers = function (key, values, callback) {
		if (!key) {
			return callback();
		}
		values = values.map(helpers.valueToString);
		db.collection('objects').find({ _key: key, value: { $in: values } }, { projection: { _id: 0, _key: 0, score: 0 } }).toArray(function (err, results) {
			if (err) {
				return callback(err);
			}
			var isMember = {};
			results.forEach(function (item) {
				if (item) {
					isMember[item.value] = true;
				}
			});

			values = values.map(function (value) {
				return !!isMember[value];
			});
			callback(null, values);
		});
	};

	module.isMemberOfSortedSets = function (keys, value, callback) {
		if (!Array.isArray(keys) || !keys.length) {
			return setImmediate(callback, null, []);
		}
		value = helpers.valueToString(value);
		db.collection('objects').find({ _key: { $in: keys }, value: value }, { projection: { _id: 0, score: 0 } }).toArray(function (err, results) {
			if (err) {
				return callback(err);
			}
			var isMember = {};
			results.forEach(function (item) {
				if (item) {
					isMember[item._key] = true;
				}
			});

			results = keys.map(function (key) {
				return !!isMember[key];
			});
			callback(null, results);
		});
	};

	module.getSortedSetsMembers = function (keys, callback) {
		if (!Array.isArray(keys) || !keys.length) {
			return setImmediate(callback, null, []);
		}
		db.collection('objects').find({ _key: { $in: keys } }, { projection: { _id: 0, score: 0 } }).sort({ score: 1 }).toArray(function (err, data) {
			if (err) {
				return callback(err);
			}

			var sets = {};
			data.forEach(function (set) {
				sets[set._key] = sets[set._key] || [];
				sets[set._key].push(set.value);
			});

			var returnData = new Array(keys.length);
			for (var i = 0; i < keys.length; i += 1) {
				returnData[i] = sets[keys[i]] || [];
			}
			callback(null, returnData);
		});
	};

	module.sortedSetIncrBy = function (key, increment, value, callback) {
		callback = callback || helpers.noop;
		if (!key) {
			return callback();
		}
		var data = {};
		value = helpers.valueToString(value);
		data.score = parseFloat(increment);

		db.collection('objects').findOneAndUpdate({ _key: key, value: value }, { $inc: data }, { returnOriginal: false, upsert: true }, function (err, result) {
			// if there is duplicate key error retry the upsert
			// https://github.com/NodeBB/NodeBB/issues/4467
			// https://jira.mongodb.org/browse/SERVER-14322
			// https://docs.mongodb.org/manual/reference/command/findAndModify/#upsert-and-unique-index
			if (err && err.message.startsWith('E11000 duplicate key error')) {
				return process.nextTick(module.sortedSetIncrBy, key, increment, value, callback);
			}
			callback(err, result && result.value ? result.value.score : null);
		});
	};

	module.getSortedSetRangeByLex = function (key, min, max, start, count, callback) {
		sortedSetLex(key, min, max, 1, start, count, callback);
	};

	module.getSortedSetRevRangeByLex = function (key, max, min, start, count, callback) {
		sortedSetLex(key, min, max, -1, start, count, callback);
	};

	module.sortedSetLexCount = function (key, min, max, callback) {
		sortedSetLex(key, min, max, 1, 0, 0, function (err, data) {
			callback(err, data ? data.length : null);
		});
	};

	function sortedSetLex(key, min, max, sort, start, count, callback) {
		if (!callback) {
			callback = start;
			start = 0;
			count = 0;
		}

		var query = { _key: key };
		buildLexQuery(query, min, max);

		db.collection('objects').find(query, { projection: { _id: 0, _key: 0, score: 0 } })
			.sort({ value: sort })
			.skip(start)
			.limit(count === -1 ? 0 : count)
			.toArray(function (err, data) {
				if (err) {
					return callback(err);
				}
				data = data.map(function (item) {
					return item && item.value;
				});
				callback(err, data);
			});
	}

	module.sortedSetRemoveRangeByLex = function (key, min, max, callback) {
		callback = callback || helpers.noop;

		var query = { _key: key };
		buildLexQuery(query, min, max);

		db.collection('objects').deleteMany(query, function (err) {
			callback(err);
		});
	};

	function buildLexQuery(query, min, max) {
		if (min !== '-') {
			if (min.match(/^\(/)) {
				query.value = { $gt: min.slice(1) };
			} else if (min.match(/^\[/)) {
				query.value = { $gte: min.slice(1) };
			} else {
				query.value = { $gte: min };
			}
		}
		if (max !== '+') {
			query.value = query.value || {};
			if (max.match(/^\(/)) {
				query.value.$lt = max.slice(1);
			} else if (max.match(/^\[/)) {
				query.value.$lte = max.slice(1);
			} else {
				query.value.$lte = max;
			}
		}
	}

	module.processSortedSet = function (setKey, processFn, options, callback) {
		var done = false;
		var ids = [];
		var project = { _id: 0, _key: 0 };
		if (!options.withScores) {
			project.score = 0;
		}
		var cursor = db.collection('objects').find({ _key: setKey }, { projection: project })
			.sort({ score: 1 })
			.batchSize(options.batch);

		async.whilst(
			function (next) {
				next(null, !done);
			},
			function (next) {
				async.waterfall([
					function (next) {
						cursor.next(next);
					},
					function (item, _next) {
						if (item === null) {
							done = true;
						} else {
							ids.push(options.withScores ? item : item.value);
						}

						if (ids.length < options.batch && (!done || ids.length === 0)) {
							return process.nextTick(next, null);
						}
						processFn(ids, function (err) {
							_next(err);
						});
					},
					function (next) {
						ids = [];
						if (options.interval) {
							setTimeout(next, options.interval);
						} else {
							process.nextTick(next);
						}
					},
				], next);
			},
			callback
		);
	};
};
