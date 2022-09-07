import {buildSpecializationTree, createGeneralizedQuery, toString} from './queryHandling.js';

function aggregateInstances({instances, specializations, ...queryData}) {
    return {
        ...queryData,
        numOfInstances: instances.length,
        numOfExecutions: instances.reduce((sum, instance) => sum + instance.numOfExecutions, 0),
        specializations: specializations.map(aggregateInstances)
    }
}

function textualForm({queryPieces, parameterByPosition, specializations, ...queryData}) {
    return {
        text: toString({queryPieces, parameterByPosition}),
        ...queryData,
        specializations: specializations.map(textualForm)
    }
}

function sortByNumOfExecutions(queryArray) {
    queryArray.sort((a, b) => b.numOfExecutions - a.numOfExecutions);
    for (const {specializations} of queryArray) {
        sortByNumOfExecutions(specializations);
    }
}

export default async function aggregateAndSpecialize(queryStream, options = {}) {
    const paramQueryMap = new Map();
    console.time('create generalization dictionary');
    var queryCounter = 0;
    for await (const {text: queryText, ...queryData} of queryStream) {
        if (queryCounter % 1000 === 0) {
            process.stdout.write(('' + queryCounter / 1000).padStart(8, ' ') + ' K\r');
        }
        const {generalizedQuery, constants} = createGeneralizedQuery(queryText, options);
        const queryStr = toString(generalizedQuery);
        const instance = {
            bindings: constants,
            ...queryData
        };
        if (paramQueryMap.has(queryStr)) {
            paramQueryMap.get(queryStr).instances.push(instance);
        } else {
            paramQueryMap.set(queryStr, {
                ...generalizedQuery,
                instances: [instance]
            });
        }
        queryCounter++;
    }
    console.timeEnd('create generalization dictionary');
    console.log(queryCounter + ' queries managed');

    console.time('build specialization forest');
    var queryForest = [];
    queryCounter = 0;
    for (const [queryStr, queryData] of paramQueryMap) {
        if (queryCounter % 1000 === 0) {
            process.stdout.write(('' + queryCounter / 1000).padStart(8, ' ') + ' K\r');
        }
        queryForest.push(buildSpecializationTree(queryData, options));
        queryCounter++;
    }
    console.timeEnd('build specialization forest');
    console.log(queryCounter + ' specialization trees built');

    if (options.countInstances) {
        console.time('aggregating instances');
        queryForest = queryForest.map(aggregateInstances);
        console.timeEnd('aggregating instances');
    }

    console.time('queries as text');
    queryForest = queryForest.map(textualForm);
    console.timeEnd('queries as text');

    console.time('sort queries');
    sortByNumOfExecutions(queryForest);
    console.timeEnd('sort queries');

    return queryForest;
}

