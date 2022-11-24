import fs from 'fs';

import { parse } from 'csv-parse';

import splitStreamByGroups from './splitStreamByGroups.js';
import SparqlGraphConnection from './sparqlGraphConnection.js';
import { buildStoreGraphUrl } from './queryEndpoint.js';

async function* map(inputGenerator, fn) {
    for await (const data of inputGenerator) {
        yield fn(data);
    }
}

async function loadClustersData(globalStream, sourceIRI, options) {
    const clusterStream = splitStreamByGroups(globalStream);
    const outputGraphConnection = new SparqlGraphConnection(
        buildStoreGraphUrl(options.outputGraphStoreURL, options.outputGraphname), {
        preamble: `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX dcterms: <http://purl.org/dc/terms/>
        `
    });
    for await (const cluster of clusterStream) {
        if (options.startFrom && cluster.groupId < options.startFrom) {
            console.log('Skipping group ' + cluster.groupId + '...');
            for await (const {} of cluster.queryStream) {}
            continue;
        }
        // console.log('****************************************');
        // console.log('**** Group ' + cluster.groupId + ' *****');
        console.log('Loading group ' + cluster.groupId + '...');
        // console.log('****************************************');

        outputGraphConnection.post(`
        <${sourceIRI}/clusters/${cluster.groupId}>
            dcterms:isPartOf <${sourceIRI}>;
            dcterms:identifier ${cluster.groupId}.
        `);

        // sourceGraphname
        // sourceEndpointURL

        // console.log('');
        var queryCounter = 0;
        for await (const query of cluster.queryStream) {
            if (queryCounter % 1000 === 0) {
                process.stdout.write(queryCounter / 1000 + ' K\r');
            }
            queryCounter++;
            await outputGraphConnection.post(`
            <${sourceIRI}/clusters/${cluster.groupId}> rdfs:member <${query.queryURI}>.
            `);
        }
        console.log('\nDone!');
    }
    await outputGraphConnection.sync();
}

async function loadClustersDataFromFile(filename, sourceIRI, options) {
    const queriesInputStream = fs.createReadStream(filename);
    const parser = parse({
        delimiter: ',',
        columns: ['groupId','queryURI','query'],
        cast: (value, context) => {
            // if (context.header) return value;
            if (context.column === 0) return Number(value);
            return String(value);
        }
    });
    const inputRecords = queriesInputStream.pipe(parser);
    await loadClustersData(inputRecords, sourceIRI, options);
}

async function loadClustersDataFromDirectory(options) {
    const filenames = await fs.promises.readdir(options.dirpath);
    for (const filename of filenames) {
        if (!options.test || options.test.test(filename)) {
            const datasetName = options.dirpathSuffix ?
                    filename.substring(0, filename.length - options.dirpathSuffix.length) :
                    filename;
            const clustersDataFilename = options.dirpath + filename + (options.filepathSuffix || '');
            const datasetURI = options.datasetsNs + datasetName;
            // console.log(datasetURI);
            console.log(clustersDataFilename);
            await loadClustersDataFromFile(clustersDataFilename, datasetURI, options);
        }
    }
}

async function main() {
    // await loadClustersDataFromFile(
    //     '/Users/miguel/Downloads/LSQExtractedQueries_features_wu/bench-kegg-lsq2.nt.bz2/clusters.csv',
    //     'clusters.csv',
    //     'http://lsq.aksw.org/datasets/bench-kegg-lsq2',
    //     {
    //         outputGraphStoreURL: 'http://localhost:3030/lsq2/data',
    //         outputGraphname: 'http://lsq.aksw.org/clustering/v1'
    //     }
    // );
    await loadClustersDataFromDirectory({
        dirpath: '/Users/miguel/Downloads/LSQExtractedQueries_features_wu/',
        test: /bench-.*/,
        dirpathSuffix: '.nt.bz2',
        filepathSuffix: '/clusters.csv',
        outputGraphStoreURL: 'http://localhost:3030/lsq2/data',
        outputGraphname: 'http://lsq.aksw.org/clustering/v1',
        datasetsNs: 'http://lsq.aksw.org/datasets/'
    });
}

main().then(result => {
    console.log('OK');
}, err => {
    console.error(err);
});

// const queriesInputStream = fs.createReadStream('./input/dbpedia_clusters/clusters.csv');
