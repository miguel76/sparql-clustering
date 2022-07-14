import fs from "fs";

import { parse } from 'csv-parse';
import {Parser} from 'sparqljs';

import lineColumn from 'line-column';

const QUERY_SYMBOLS = [
    'SELECT',
    'CONSTRUCT',
    'ASK',
    'DESCRIBE'
];

const GENERALIZABLE_SYMBOLS = [
    'PNAME_LN',
    'IRIREF',
    'INTEGER',
    'DECIMAL',
    'DOUBLE',
    'INTEGER_POSITIVE',
    'DECIMAL_POSITIVE',
    'DOUBLE_POSITIVE',
    'INTEGER_NEGATIVE',
    'DECIMAL_NEGATIVE',
    'DOUBLE_NEGATIVE',
    'STRING_LITERAL1',
    'STRING_LITERAL2',
    'STRING_LITERAL_LONG1',
    'STRING_LITERAL_LONG2'
];

const EOF = 6;

function generalizeQuery(queryStr, options = {}) {
    const sparqlParser = new Parser();
    const lexer = sparqlParser.lexer;
    lexer.setInput(queryStr);
    const lcFinder = lineColumn(inputStr);
    var afterPreamble = false;
    var symbol;
    var prevStrEnd = 0;
    var parents = [{query: queryStr, paramBindings: []}];
    while((symbol = lexer.lex()) !== EOF) {
        // console.log(symbol);
        // console.log(sparqlParser.terminals_[symbol]);
        // console.log(lexer.match);
        const loc = lexer.yylloc;
        const strStart = lcFinder.toIndex(loc.first_line, loc.first_column + 1);
        if (strStart > prevStrEnd) {
            parents = parents.map(parent => ({ query: parent.query + queryStr.substring(prevStrEnd, strStart), paramBindings: parent.paramBindings}))
        }
        if (QUERY_SYMBOLS.includes(sparqlParser.terminals_[symbol])) {
            afterPreamble = true;
        } else if (afterPreamble
                && (options.maxVars === undefined || options.maxVars )
                && GENERALIZABLE_SYMBOLS.includes(sparqlParser.terminals_[symbol])) {
            const parentsNoGen = parents.map(parent => ({ query: parent.query + lexer.match, paramBindings: parent.paramBindings}));
            const parentsToGen = options.maxVars === undefined ? parents : parents.filter(parent => parent.paramBindings.length < options.maxVars);
            const parentsGen = parentsToGen.map(parent => ({
                query: parent.query + '<PARAM_' + parent.paramBindings.length + '>',
                paramBindings: parent.paramBindings.concat([lexer.match])
            }));
            parents = parentsNoGen.concat(parentsGen);
        } else {
            parents = parents.map(parent => ({ query: parent.query + lexer.match, paramBindings: parent.paramBindings}))
        }
        prevStrEnd = lcFinder.toIndex(loc.last_line, loc.last_column + 1);
        // console.log('prevStrEnd: ' + prevStrEnd);
    }
    parents = parents.map(parent => ({ query: parent.query + queryStr.substring(prevStrEnd), paramBindings: parent.paramBindings}))
    return parents;
}


const inputStr = `

PREFIX foaf: <http://xmlns.com/foaf/0.1/> 

SELECT * {
    ?mickey foaf:name "Mickey Mouse"@en;
        foaf:knows ?other.
}


`;

console.log(generalizeQuery(inputStr));

console.log(generalizeQuery(inputStr, {maxVars: 0}));

console.log(generalizeQuery(inputStr, {maxVars: 1}));

console.log(generalizeQuery(inputStr, {maxVars: 2}));
