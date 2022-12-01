import fs from 'fs';

import aggregateAndSpecialize from './aggregateAndSpecialize.js';
import ParametricQueriesStorage from './storeForest.js';
import queryEndpoint from './queryEndpoint.js';

const queriesQuery = fs.readFileSync('./queries/queries.rq');
const clustersQuery = '' + fs.readFileSync('./queries/clusters.rq');
const queriesOfClusterQuery = '' + fs.readFileSync('./queries/queriesOfCluster.rq');
const datasetsQuery = fs.readFileSync('./queries/datasets.rq');

/**
 * Run the aggregation process
 * @param  {object} options Options to configure the process
 * @param  {string} options.inputEndpointURL URL of the endpoint from which source data is read
 * @param  {string[]} options.inputGraphnames Optionally, array of IRIs corresponding to the graph names from which the data source is read (if undefined or empty, the default graph is used)
 * @param  {object} options.cluster Optionally, IRI of a cluster the queries considered need to belong to
 * @param  {object} options.clusterId Optionally, numeric id of the cluster (unique in a dataset)
 * @param  {object} options.clustersGraphname Optionally, graph name containing the decomposition of the query dataset in clusters
 * @param  {object} options.dataset Optionally, IRI of the input dataset, typically corresponding to a single inputGraphname
 * @param  {object} options.datasetId Optionally, string used to identify the dataset
 * @param  {object} options.datasetsGraphname Optionally, graph name containing the description of a set of datasets, a.k.a. graphnames with input data
 * @param  {object} options.excludeDatasets Optionally, array of dataset IRIs to be excluded
 * @param  {string} options.outputGraphStoreURL URL of the graph store to which the output is written
 * @param  {string} options.outputDirPath path of the directory to which the output is written as n-triples or n-quads files
 * @param  {string} options.format MIME type of the serialization to be used for the files (either application/n-triples or application/n-quads)
 * @param  {string} options.outputGraphname Optionally, IRI corresponding to the graph name to which the output is written (if undefined, the default graph is used)
 * @param  {boolean} options.overwriteOutputGraph If true, the target graph for the result is overwritten. Otherwise, the results are added to the current content of the graph.
 * @param  {string} options.metadataUpdateURL URL of the update endpoint used to update the metadata about process execution (maust correspond to the same triple store as options.metadataGraphStoreURL)
 * @param  {string} options.metadataGraphname Optionally, IRI corresponding to the graph name to which the metadata about process execution is written (if undefined, the default graph is used)
 * @param  {string} options.resourcesNs Root namespace used to mint resource IRIs
 * @param  {boolean} options.excludePreamble If true, query preambles are not considered for aggregation (defaults to false)
 * @param  {boolean} options.sparqlParameters If true, parameters are represented in the query string format preserving SPARQL syntax (defaults to false)
 * @param  {number} options.maxTokens Optionally, max number of tokens that are parsed for each query
 * @param  {number} options.minNumOfInstances Optionally, min number of instances that a parametric query must have to be in the output
 * @param  {number} options.minNumOfExecutions Optionally, min number of executions that a parametric query must have to be in the output
 * @param  {number} options.minNumOfInstancesInSubclass Optionally, min number of instances that a parametric query must have to be in the output as specilization of a parent query
 * @param  {number} options.minNumOfExecutionsInSubclass Optionally, min number of executions that a parametric query must have to be in the output as specilization of a parent query
 * @param  {number} options.bufferSize Size (in bytes) of the buffer used while storing the output (defaults to 5MB)
 * @param  {number} options.maxCalls Max number of simultaneous serve calls performed for storing the output (defaults to 10)
 * @param  {object} options.defaultPreamble Default preamble object used for IRI expansion on top of in-query preamble.
*/
export default async function runAggregation(options) {
    if (options.datasetsGraphname) {
        const {datasetsGraphname, defaultPreamble, ...otherOptions} = options;
        const datasets = queryEndpoint(
            options.inputEndpointURL, [datasetsGraphname], datasetsQuery);
        for await (const {dataset, datasetId, prefixesJson} of datasets) {
            if (!options.excludeDatasets || !options.excludeDatasets.includes(dataset)) {
                const prefixes = prefixesJson && JSON.parse(prefixesJson);
                console.log('Dataset: ' + dataset);
                // console.log(prefixes);
                await runAggregation({
                    ...otherOptions,
                    dataset,
                    inputGraphnames: [dataset],
                    outputGraphname: `${dataset}/templates`,
                    outputGraphnameId: datasetId,
                    defaultPreamble: defaultPreamble ?
                            {
                                ...defaultPreamble,
                                prefixes: {
                                    ...defaultPreamble.prefixes,
                                    ...prefixes
                                }
                            } :
                            prefixes ? {prefixes} : undefined
                });
            }
        }
    } else if (options.clustersGraphname) {
        const {clustersGraphname, inputGraphnames, overwriteOutputGraph, ...otherOptions} = options;
        for (const inputGraphname of inputGraphnames) {
            // console.log('ready to query');
            // console.log(clustersQuery.replaceAll('?dataset', `<${inputGraphname}>`));
            const clusters = queryEndpoint(
                options.inputEndpointURL, [clustersGraphname],
                clustersQuery.replaceAll('?dataset', `<${inputGraphname}>`)
            );
            let first = true;
            for await (const {cluster, clusterId} of clusters) {
                console.log('Cluster: ' + clusterId);
                await runAggregation({
                    ...otherOptions,
                    cluster,
                    clusterId,
                    inputGraphnames: [...inputGraphnames, clustersGraphname],
                    overwriteOutputGraph: first && overwriteOutputGraph
                });
                first = false;
            }
        }
    } else {
        console.time('aggregation');
        const storage = new ParametricQueriesStorage(options)
        const actionId = await storage.recordProcessStart();
        try {
            // console.log('ready to query');
            // console.log(options.cluster ? queriesOfClusterQuery.replaceAll('?cluster', `<${options.cluster}>`) : queriesQuery);
            const queries = queryEndpoint(
                options.inputEndpointURL, options.inputGraphnames,
                options.cluster ? queriesOfClusterQuery.replaceAll('?cluster', `<${options.cluster}>`) : queriesQuery);
            const result = await aggregateAndSpecialize(queries, options);
            console.time('storeResults');
            if (options.includeSimpleQueries) {
                await storage.storeForest(result.queryForest, null, actionId);
                await storage.linkSingleQueries(result.nonClusterizedQueryIds, actionId);
            } else {
                await storage.storeForest(result, null, actionId);
            }
            await storage.recordProcessCompletion(actionId);
            console.timeEnd('storeResults');
        } catch(error) {
            await storage.recordProcessFailure(actionId, error);
            throw error;
        }
        console.timeEnd('aggregation');
    }
}

async function test() {
    // const graphStoreURL = 'http://localhost:3030/lsqDev/data';
    // const endpointURL = 'http://localhost:3030/lsqDev/query';
    // const updateURL = 'http://localhost:3030/lsqDev/update';
    // const inputGraphnames = ['https://dbpedia.org/sparql'];
    // const outputGraphname = 'https://dbpedia.org/sparql/result/data';
    // const metadataGraphname = 'https://dbpedia.org/sparql/result';
    // bench-dbpedia-20151025-lsq2
    // const datasetName = 'bench-kegg-lsq2';
    const graphStoreURL = 'http://localhost:3030/lsq2/data';
    const endpointURL = 'http://localhost:3030/lsq2/query';
    const updateURL = 'http://localhost:3030/lsq2/update';
    // const inputGraphnames = [`http://lsq.aksw.org/datasets/${datasetName}`];
    // const outputGraphname = `http://lsq.aksw.org/results/${datasetName}`;
    const metadataGraphname = 'http://lsq.aksw.org/results';

    await runAggregation({
        // maxVars: 3,
        excludePreamble: true,
        generalizationTree: true,
        // onlyRoots: true,
        asArray: true,
        // minNumOfExecutions: 50,
        // minNumOfHosts: 10,
        sparqlParameters: true,
        includeSimpleQueries: true,
        // countInstances: true,
        // minBindingDivergenceRatio: 0.05,
        asArray: true,
        minNumOfInstances: 4,
        // defaultPreamble: {
        //     prefixes: dbpediaPrefixes
        // },
        // showBindingDistributions: true
        inputEndpointURL: endpointURL, 
        // outputGraphStoreURL: graphStoreURL, 
        outputDirPath: './output-rdf/',
        metadataUpdateURL: updateURL,
        // inputGraphnames: ['http://lsq.aksw.org/datasets/bench-dbpedia-20151126-lsq2'], //, 'http://lsq.aksw.org/clustering/v1'],
        // outputGraphname,
        metadataGraphname,
        resourcesNs: 'http://sparql-clustering.org/',
        datasetsGraphname: 'http://lsq.aksw.org/datasets',
        clustersGraphname: 'http://lsq.aksw.org/clustering/v1',
        // format: 'application/n-quads'
        // cluster: 'http://lsq.aksw.org/datasets/bench-dbpedia-20151126-lsq2/clusters/1',
        // excludeDatasets: [
            // 'http://lsq.aksw.org/datasets/bench-affymetrix-lsq2',
            // 'http://lsq.aksw.org/datasets/bench-biomedels-lsq2',
            // 'http://lsq.aksw.org/datasets/bench-bioportal-lsq2',
            // 'http://lsq.aksw.org/datasets/bench-ctd-lsq2',
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20151025-lsq2',
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20151124-lsq2',
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20151126-lsq2', //missing
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20151213-lsq2',
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20151230-lsq2',
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20160117-lsq2',
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20160212-lsq2',
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20160222-lsq2', //missing
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20160301-lsq2', //missing
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20160303-lsq2', //missing
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20160304-lsq2', //missing
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20160314-lsq2'
            // 'http://lsq.aksw.org/datasets/bench-dbpedia-20160411-lsq2', //missing
            // 'http://lsq.aksw.org/datasets/bench-dbpedia.3.5.1.log-lsq2' //missing
        // ]

    })
}

test().then(result => {
}, err => {
  console.error(err);
});

