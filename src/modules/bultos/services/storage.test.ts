import { storeDailyMeasurements, fetchClientAliases } from './storage';

/**
 * interaction with prisma to store the measurements in the database
 * happy path: store the valid measurements in the database and return a success message
 * error path: if some measurements are invalid, store the valid ones and put the invalid ones in an error table
 */

describe('Fetch client aliases', () => {
    it('should fetch client aliases from the database', async () => {
        const aliases = await fetchClientAliases();
    });
});